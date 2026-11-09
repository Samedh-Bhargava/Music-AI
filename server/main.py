from __future__ import annotations

import asyncio
import csv
import hmac
import importlib.util
import io
import math
import os
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import numpy as np
from defusedxml import ElementTree as SafeXML
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool


ROOT = Path(__file__).resolve().parent.parent
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_AUDIO_SECONDS = 600
MAX_NOTES = 5000
ALLOWED_IMAGE = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".pdf"}
ALLOWED_AUDIO = {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aiff", ".aif"}
KEY_NAMES = {
    (0, "major"): "C major", (1, "major"): "G major", (2, "major"): "D major",
    (3, "major"): "A major", (4, "major"): "E major", (5, "major"): "B major",
    (6, "major"): "F# major", (7, "major"): "C# major", (-1, "major"): "F major",
    (-2, "major"): "Bb major", (-3, "major"): "Eb major", (-4, "major"): "Ab major",
    (-5, "major"): "Db major", (-6, "major"): "Gb major", (-7, "major"): "Cb major",
    (0, "minor"): "A minor", (1, "minor"): "E minor", (2, "minor"): "B minor",
    (3, "minor"): "F# minor", (4, "minor"): "C# minor", (5, "minor"): "G# minor",
    (6, "minor"): "D# minor", (7, "minor"): "A# minor", (-1, "minor"): "D minor",
    (-2, "minor"): "G minor", (-3, "minor"): "C minor", (-4, "minor"): "F minor",
    (-5, "minor"): "Bb minor", (-6, "minor"): "Eb minor", (-7, "minor"): "Ab minor",
}
PITCH_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
VELOCITY_DYNAMICS = ((38, "pp"), (54, "p"), (70, "mp"), (88, "mf"), (106, "f"), (128, "ff"))
_musicbrainz_lock = asyncio.Lock()
_musicbrainz_last_request = 0.0


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(element: Any, name: str) -> Any | None:
    return next((node for node in list(element) if _local_name(node.tag) == name), None)


def _text(element: Any | None, name: str, default: str = "") -> str:
    if element is None:
        return default
    child = _child(element, name)
    if child is None or child.text is None:
        return default
    return child.text.strip()


def _float(value: str, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def _midi_pitch(step: str, alter: float, octave: str) -> tuple[str, int] | None:
    base = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}.get(step)
    if base is None or not re.fullmatch(r"-?\d+", octave):
        return None
    accidental = int(round(alter))
    if abs(alter - accidental) > 0.01 or accidental not in (-2, -1, 0, 1, 2):
        return None
    midi = (int(octave) + 1) * 12 + base + accidental
    if midi < 0 or midi > 127:
        return None
    pitch = f"{PITCH_NAMES[midi % 12]}{midi // 12 - 1}"
    return pitch, midi


def _extract_musicxml(data: bytes) -> bytes:
    if data.lstrip().startswith(b"<"):
        return data
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = archive.namelist()
            container = next((name for name in names if name.lower() == "meta-inf/container.xml"), None)
            if container:
                root = SafeXML.fromstring(archive.read(container))
                for element in root.iter():
                    if _local_name(element.tag) == "rootfile":
                        musicxml_path = element.attrib.get("full-path")
                        if musicxml_path in names:
                            return archive.read(musicxml_path)
            candidate = next(
                (name for name in names if name.lower().endswith((".musicxml", ".xml")) and not name.lower().startswith("meta-inf/")),
                None,
            )
            if candidate:
                return archive.read(candidate)
    except (zipfile.BadZipFile, KeyError) as error:
        raise ValueError("Audiveris produced a score that could not be opened.") from error
    raise ValueError("Audiveris did not produce a MusicXML score.")


def parse_musicxml(data: bytes, fallback_title: str) -> dict[str, Any]:
    try:
        root = SafeXML.fromstring(_extract_musicxml(data))
    except Exception as error:
        raise ValueError("The score output is not valid MusicXML.") from error
    if _local_name(root.tag) != "score-partwise":
        raise ValueError("Only partwise MusicXML scores are currently supported.")
    parts = [element for element in list(root) if _local_name(element.tag) == "part"]
    if not parts:
        raise ValueError("No score part was found in the MusicXML file.")
    first_part = parts[0]
    part_id = first_part.attrib.get("id", "")
    part_list = next((element for element in list(root) if _local_name(element.tag) == "part-list"), None)
    part_name = ""
    if part_list is not None:
        for score_part in list(part_list):
            if score_part.attrib.get("id") == part_id:
                part_name = _text(score_part, "part-name")
                break
    instrument = next(
        (name for name in ("Piano", "Guitar", "Violin", "Flute") if name.casefold() == part_name.casefold()),
        "Piano",
    )
    work = next((element for element in list(root) if _local_name(element.tag) == "work"), None)
    title = _text(work, "work-title") or _text(root, "movement-title") or fallback_title[:100]
    identification = next((element for element in list(root) if _local_name(element.tag) == "identification"), None)
    composer = ""
    if identification is not None:
        composer = next(
            (element.text.strip() for element in identification.iter() if _local_name(element.tag) == "creator" and element.attrib.get("type") == "composer" and element.text),
            "",
        )

    divisions = 1.0
    numerator, denominator = 4, 4
    key = "C major"
    tempo = 96
    dynamic = "mf"
    notes: list[dict[str, Any]] = []
    measures = [element for element in list(first_part) if _local_name(element.tag) == "measure"]
    for measure_index, measure in enumerate(measures, start=1):
        raw_number = measure.attrib.get("number", "")
        measure_number = int(raw_number) if raw_number.isdigit() and int(raw_number) > 0 else measure_index
        cursor = 0.0
        previous_note_start: float | None = None
        for item in list(measure):
            kind = _local_name(item.tag)
            if kind == "attributes":
                divisions = max(1.0, _float(_text(item, "divisions"), divisions))
                key_node = _child(item, "key")
                if key_node is not None:
                    fifths = int(_float(_text(key_node, "fifths"), 0))
                    mode = _text(key_node, "mode", "major").lower()
                    key = KEY_NAMES.get((fifths, mode), key)
                time_node = _child(item, "time")
                if time_node is not None:
                    numerator = max(1, min(32, int(_float(_text(time_node, "beats"), numerator))))
                    denominator = max(1, min(32, int(_float(_text(time_node, "beat-type"), denominator))))
            elif kind == "direction":
                per_minute = _child(item, "per-minute")
                if per_minute is not None:
                    parsed_tempo = int(_float(per_minute.text or "", tempo))
                    if 30 <= parsed_tempo <= 240:
                        tempo = parsed_tempo
                dynamics = next((node for node in item.iter() if _local_name(node.tag) == "dynamics"), None)
                if dynamics is not None:
                    marking = next((_local_name(node.tag) for node in list(dynamics)), "")
                    if marking in {"pp", "p", "mp", "mf", "f", "ff"}:
                        dynamic = marking
            elif kind == "sound":
                parsed_tempo = int(_float(item.attrib.get("tempo", ""), tempo))
                if 30 <= parsed_tempo <= 240:
                    tempo = parsed_tempo
            elif kind in {"backup", "forward"}:
                amount = _float(_text(item, "duration")) / divisions
                cursor = max(0.0, cursor + (-amount if kind == "backup" else amount))
                previous_note_start = None
            elif kind == "note":
                duration = max(0.0625, _float(_text(item, "duration"), divisions) / divisions)
                is_chord_note = _child(item, "chord") is not None
                if _child(item, "rest") is not None:
                    if not is_chord_note:
                        cursor += duration
                        previous_note_start = None
                    continue
                pitch_node = _child(item, "pitch")
                if pitch_node is None:
                    if not is_chord_note:
                        previous_note_start = cursor
                        cursor += duration
                    continue
                parsed_pitch = _midi_pitch(
                    _text(pitch_node, "step"),
                    _float(_text(pitch_node, "alter"), 0),
                    _text(pitch_node, "octave"),
                )
                if parsed_pitch is None:
                    if not is_chord_note:
                        previous_note_start = cursor
                        cursor += duration
                    continue
                pitch, _ = parsed_pitch
                staff = "L" if _text(item, "staff") == "2" else "R"
                finger_node = next((node for node in item.iter() if _local_name(node.tag) == "fingering"), None)
                finger = finger_node.text.strip() if finger_node is not None and finger_node.text else ""
                note: dict[str, Any] = {
                    "pitch": pitch,
                    "measure": measure_number,
                    "beat": round(
                        previous_note_start if is_chord_note and previous_note_start is not None else cursor,
                        4,
                    ),
                    "duration": round(duration, 4),
                    "hand": staff,
                    "finger": finger[:2],
                    "dynamic": dynamic,
                }
                notes.append(note)
                if not is_chord_note:
                    previous_note_start = cursor
                    cursor += duration
    if not notes:
        raise ValueError("The score engine found no readable pitched notes.")
    if len(notes) > MAX_NOTES:
        notes = notes[:MAX_NOTES]
    return {
        "title": title[:100] or "Recognized score",
        "composer": composer[:100],
        "instrument": instrument,
        "tempo": tempo,
        "meter": f"{numerator}/{denominator}",
        "key": key,
        "measureCount": max(measure["measure"] for measure in notes),
        "notes": notes,
    }


def _audiveris_command() -> str:
    command = os.getenv("AUDIVERIS_BIN", "audiveris")
    resolved = shutil.which(command)
    if resolved:
        return resolved
    if Path(command).is_file():
        return command
    raise RuntimeError(
        "Audiveris is not installed or AUDIVERIS_BIN is not configured. "
        "Install the official Audiveris CLI or use the provided Docker image."
    )


def recognize_score(source: Path, fallback_title: str) -> dict[str, Any]:
    command = _audiveris_command()
    with tempfile.TemporaryDirectory(prefix="sonora-omr-") as directory:
        output = Path(directory) / "output"
        output.mkdir()
        try:
            result = subprocess.run(
                [command, "-batch", "-transcribe", "-export", "-output", str(output), str(source)],
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("Score recognition timed out after 5 minutes.") from error
        candidates = sorted(
            path for path in output.rglob("*")
            if path.is_file() and path.suffix.lower() in {".mxl", ".musicxml", ".xml"}
        )
        log_output = "\n".join(
            path.read_text(encoding="utf-8", errors="replace")
            for path in output.rglob("*.log")
            if path.is_file()
        )
        diagnostic_lines = "\n".join(
            part for part in (result.stdout, result.stderr, log_output) if part
        ).splitlines()
        useful_lines = [
            line.strip()
            for line in diagnostic_lines
            if line.strip()
            and any(
                marker in line.casefold()
                for marker in (
                    "warn",
                    "error",
                    "exception",
                    "invalid",
                    "too few black pixels",
                    "created scores",
                    "could not export",
                    "cause detected",
                )
            )
        ]
        detail = "\n".join(useful_lines[-20:])[-2400:]
        if result.returncode != 0 and not candidates:
            message = "Audiveris could not recognize this score."
            if detail:
                message += f"\nAudiveris output:\n{detail}"
            raise RuntimeError(message)
        if not candidates:
            message = (
                "Audiveris finished without exporting MusicXML. It may have rejected the input "
                "or failed during transcription. If Audiveris reports no score systems or too few "
                "black pixels, confirm the image visibly contains the whole notation page, is "
                "straight and high contrast, and is not mostly blank."
            )
            if detail:
                message += f"\nAudiveris output:\n{detail}"
            raise RuntimeError(message)
        return parse_musicxml(candidates[0].read_bytes(), fallback_title)


def _activation_for_note(output: Any, pitch: int, start: float, end: float) -> float | None:
    if not isinstance(output, dict) or "note" not in output:
        return None
    activations = np.asarray(output["note"])
    if activations.ndim == 3:
        activations = activations[0]
    if activations.ndim != 2 or activations.shape[0] == 0:
        return None
    pitch_index = pitch - 21
    if pitch_index < 0 or pitch_index >= activations.shape[1]:
        return None
    sample_rate = 22050
    hop_size = 256
    frame_start = max(0, min(activations.shape[0] - 1, int(start * sample_rate / hop_size)))
    frame_end = max(frame_start + 1, min(activations.shape[0], int(end * sample_rate / hop_size)))
    values = activations[frame_start:frame_end, pitch_index]
    if not len(values):
        return None
    return round(float(np.clip(np.mean(values), 0.0, 1.0)), 4)


def transcribe_audio(source: Path, title: str, tempo: int, meter: str, instrument: str) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import Model, predict

        model = _cached_basic_pitch_model(str(ICASSP_2022_MODEL_PATH), Model)
        model_output, _, events = predict(source, model_or_model_path=model, midi_tempo=tempo)
    except Exception as error:
        raise RuntimeError(
            "Basic Pitch could not load or run. Use the Python 3.11 Docker setup and ensure its model dependencies installed correctly. "
            f"Details: {str(error)[:500]}"
        ) from error
    if not events:
        raise RuntimeError("No notes were detected. Try a clearer recording with a single, prominent instrument.")
    numerator, denominator = (int(part) for part in meter.split("/"))
    bar_beats = numerator * 4 / denominator
    notes: list[dict[str, Any]] = []
    activations: list[float] = []
    for start, end, midi_pitch, velocity, _bends in events:
        if len(notes) >= MAX_NOTES:
            break
        midi_pitch = int(midi_pitch)
        if not 0 <= midi_pitch <= 127:
            continue
        start_beats = max(0.0, float(start) * tempo / 60)
        end_beats = max(start_beats + 0.25, float(end) * tempo / 60)
        quantized_start = round(start_beats * 4) / 4
        quantized_end = max(quantized_start + 0.25, round(end_beats * 4) / 4)
        measure = int(quantized_start // bar_beats) + 1
        beat = round(quantized_start - (measure - 1) * bar_beats, 4)
        duration = round(min(16.0, quantized_end - quantized_start), 4)
        activation = _activation_for_note(model_output, midi_pitch, float(start), float(end))
        if activation is not None:
            activations.append(activation)
        velocity = int(round(float(velocity) * 127))
        dynamic = next((name for threshold, name in VELOCITY_DYNAMICS if velocity < threshold), "ff")
        notes.append({
            "pitch": f"{PITCH_NAMES[midi_pitch % 12]}{midi_pitch // 12 - 1}",
            "measure": measure,
            "beat": beat,
            "duration": duration,
            "hand": "R",
            "finger": "",
            "dynamic": dynamic,
            "confidence": activation,
        })
    if not notes:
        raise RuntimeError("The audio model produced no usable notes.")
    score = {
        "title": title[:100] or source.stem[:100] or "Audio transcription",
        "composer": "",
        "instrument": instrument,
        "tempo": tempo,
        "meter": meter,
        "key": "C major",
        "measureCount": max(note["measure"] for note in notes),
        "notes": notes,
    }
    confidence = {
        "score": round(sum(activations) / len(activations), 4) if activations else None,
        "kind": "model-activation",
        "calibrated": False,
        "description": "Mean Basic Pitch note activation; useful for prioritizing review, not a calibrated probability of correctness.",
        "notesScored": len(activations),
    }
    return score, confidence


_cached_model: Any = None
_cached_model_path = ""


def _cached_basic_pitch_model(model_path: str, model_class: Any) -> Any:
    global _cached_model, _cached_model_path
    if _cached_model is None or _cached_model_path != model_path:
        _cached_model = model_class(model_path)
        _cached_model_path = model_path
    return _cached_model


async def _save_upload(upload: UploadFile, allowed_extensions: set[str]) -> tuple[Path, tempfile.TemporaryDirectory[str]]:
    extension = Path(upload.filename or "").suffix.lower()
    if extension not in allowed_extensions:
        raise HTTPException(status_code=415, detail=f"Unsupported file type. Accepted: {', '.join(sorted(allowed_extensions))}.")
    temporary = tempfile.TemporaryDirectory(prefix="sonora-upload-")
    path = Path(temporary.name) / f"source{extension}"
    total = 0
    try:
        with path.open("wb") as target:
            while chunk := await upload.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File is larger than the 25 MB limit.")
                target.write(chunk)
    except Exception:
        temporary.cleanup()
        raise
    if total == 0:
        temporary.cleanup()
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    return path, temporary


async def require_api_token(x_api_key: str | None = Header(default=None)) -> None:
    expected = os.getenv("SONORA_API_TOKEN", "")
    if expected and (not x_api_key or not hmac.compare_digest(x_api_key, expected)):
        raise HTTPException(status_code=401, detail="A valid Sonora server token is required.")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    global _cached_model, _cached_model_path
    _cached_model = None
    _cached_model_path = ""


app = FastAPI(title="Sonora Local Music AI", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key"],
)


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(ROOT / "index.html", media_type="text/html")


@app.get("/api/health")
async def health() -> dict[str, Any]:
    audiveris = shutil.which(os.getenv("AUDIVERIS_BIN", "audiveris")) is not None
    basic_pitch = importlib.util.find_spec("basic_pitch") is not None
    return {
        "status": "ok",
        "models": {
            "score_ocr": {"available": audiveris, "engine": "Audiveris"},
            "audio_transcription": {"available": basic_pitch, "engine": "Spotify Basic Pitch"},
        },
        "search": {"musicbrainz": True, "internet_archive": True, "youtube_metadata": True},
        "authentication": {"required": bool(os.getenv("SONORA_API_TOKEN"))},
    }


@app.post("/api/analyze/score", dependencies=[Depends(require_api_token)])
async def analyze_score(
    file: UploadFile = File(...),
    tempo: int = Form(default=96, ge=30, le=240),
    meter: str = Form(default="4/4", pattern=r"^\d{1,2}/(1|2|4|8|16)$"),
    key: str = Form(default="C major", max_length=20),
    instrument: str = Form(default="Piano", max_length=30),
) -> dict[str, Any]:
    del tempo, meter, key, instrument
    path, temporary = await _save_upload(file, ALLOWED_IMAGE)
    title = Path(file.filename or "Recognized score").stem
    try:
        score = await run_in_threadpool(recognize_score, path, title)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    finally:
        temporary.cleanup()
    return {
        "score": score,
        "confidence": {
            "score": None,
            "kind": "unavailable",
            "calibrated": False,
            "description": "Audiveris MusicXML export does not contain a calibrated per-note confidence score. Review the notation before relying on it.",
        },
        "source": {"kind": "sheet-image", "filename": file.filename},
    }


@app.post("/api/analyze/audio", dependencies=[Depends(require_api_token)])
async def analyze_audio(
    file: UploadFile = File(...),
    title: str = Form(default="", max_length=100),
    tempo: int = Form(default=120, ge=30, le=240),
    meter: str = Form(default="4/4", pattern=r"^\d{1,2}/(1|2|4|8|16)$"),
    instrument: str = Form(default="Piano", max_length=30),
) -> dict[str, Any]:
    if instrument not in {"Piano", "Guitar", "Violin", "Flute", "Other"}:
        raise HTTPException(status_code=422, detail="Choose a supported instrument.")
    path, temporary = await _save_upload(file, ALLOWED_AUDIO)
    try:
        score, confidence = await run_in_threadpool(transcribe_audio, path, title or Path(file.filename or "").stem, tempo, meter, instrument)
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    finally:
        temporary.cleanup()
    return {"score": score, "confidence": confidence, "source": {"kind": "audio", "filename": file.filename}}


def _lucene_phrase(value: str) -> str:
    escaped = re.sub(r'([+\-!(){}\[\]^"~*?:\\/])', r"\\\1", value.strip())
    return f'"{escaped}"'


async def _search_musicbrainz(query: str, limit: int) -> list[dict[str, Any]]:
    global _musicbrainz_last_request
    async with _musicbrainz_lock:
        wait = 1.05 - (time.monotonic() - _musicbrainz_last_request)
        if wait > 0:
            await asyncio.sleep(wait)
        _musicbrainz_last_request = time.monotonic()
    headers = {"User-Agent": "SonoraScoreStudio/1.0 (https://github.com/sonora-score-studio)"}
    async with httpx.AsyncClient(timeout=12, headers=headers) as client:
        response = await client.get(
            "https://musicbrainz.org/ws/2/recording/",
            params={"query": f"recording:{_lucene_phrase(query)}", "fmt": "json", "limit": limit},
        )
        response.raise_for_status()
    recordings = response.json().get("recordings", [])
    results = []
    for recording in recordings:
        artists = [artist.get("name", "") for artist in recording.get("artist-credit", []) if isinstance(artist, dict)]
        results.append({
            "source": "MusicBrainz",
            "kind": "recording",
            "title": recording.get("title", "Untitled recording"),
            "artist": ", ".join(artists),
            "year": (recording.get("first-release-date") or "")[:4],
            "url": f"https://musicbrainz.org/recording/{recording['id']}" if recording.get("id") else "https://musicbrainz.org/",
        })
    return results


async def _search_archive(query: str, limit: int) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=12, headers={"User-Agent": "SonoraScoreStudio/1.0"}) as client:
        response = await client.get(
            "https://archive.org/advancedsearch.php",
            params={
                "q": f"title:{_lucene_phrase(query)} AND mediatype:(audio OR texts)",
                "fl[]": ["identifier", "title", "creator", "year", "mediatype"],
                "rows": limit,
                "page": 1,
                "output": "json",
            },
        )
        response.raise_for_status()
    documents = response.json().get("response", {}).get("docs", [])
    results = []
    for document in documents:
        identifier = document.get("identifier")
        if not identifier:
            continue
        creator = document.get("creator", "")
        if isinstance(creator, list):
            creator = ", ".join(str(item) for item in creator)
        results.append({
            "source": "Internet Archive",
            "kind": document.get("mediatype", "archive"),
            "title": document.get("title", "Untitled archive item"),
            "artist": creator,
            "year": str(document.get("year", ""))[:4],
            "url": f"https://archive.org/details/{identifier}",
        })
    return results


@app.get("/api/search", dependencies=[Depends(require_api_token)])
async def search_scores(
    q: str = Query(min_length=2, max_length=120),
    limit: int = Query(default=5, ge=1, le=10),
) -> dict[str, Any]:
    tasks = {
        "MusicBrainz": _search_musicbrainz(q, limit),
        "Internet Archive": _search_archive(q, limit),
    }
    names = list(tasks)
    outcomes = await asyncio.gather(*tasks.values(), return_exceptions=True)
    results: list[dict[str, Any]] = []
    warnings: list[str] = []
    for name, result in zip(names, outcomes):
        if isinstance(result, Exception):
            warnings.append(f"{name} search failed: {str(result)[:240]}")
        else:
            results.extend(result)
    if not results and warnings:
        raise HTTPException(status_code=502, detail="; ".join(warnings))
    return {"query": q, "results": results, "warnings": warnings}


@app.get("/api/youtube", dependencies=[Depends(require_api_token)])
async def youtube_metadata(url: str = Query(min_length=8, max_length=2048)) -> dict[str, Any]:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"}:
        raise HTTPException(status_code=422, detail="Enter an HTTPS YouTube video URL.")
    if host == "youtu.be":
        video_id = parsed.path.strip("/").split("/")[0]
    elif parsed.path.startswith("/embed/") or parsed.path.startswith("/shorts/"):
        video_id = parsed.path.split("/")[2] if len(parsed.path.split("/")) > 2 else ""
    else:
        from urllib.parse import parse_qs

        video_id = parse_qs(parsed.query).get("v", [""])[0]
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise HTTPException(status_code=422, detail="The URL does not contain a valid YouTube video ID.")
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
        try:
            response = await client.get("https://www.youtube.com/oembed", params={"url": canonical, "format": "json"})
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            raise HTTPException(status_code=404, detail="YouTube could not provide metadata for that video.") from error
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail=f"YouTube metadata request failed: {error}") from error
    metadata = response.json()
    return {
        "id": video_id,
        "title": metadata.get("title", "YouTube video"),
        "author": metadata.get("author_name", ""),
        "thumbnail": metadata.get("thumbnail_url", ""),
        "url": canonical,
        "embedUrl": f"https://www.youtube-nocookie.com/embed/{video_id}",
        "analysisNote": "YouTube provides metadata and playback only. To transcribe audio, upload an audio file you have the right to use.",
    }


if not (ROOT / "index.html").is_file():
    raise RuntimeError(f"Sonora frontend was not found at {ROOT / 'index.html'}.")
