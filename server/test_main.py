import asyncio
import io
import json
import tempfile
import zipfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import numpy as np
from fastapi.testclient import TestClient

from server.main import (
    _activation_for_note,
    _extract_musicxml,
    _midi_pitch,
    _validate_score_signature,
    app,
    extract_video_audio,
    parse_musicxml,
    recognize_score,
)


MUSICXML = b"""<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <work><work-title>Test score</work-title></work>
  <identification><creator type="composer">Test composer</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>480</divisions>
        <key><fifths>2</fifths><mode>major</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction><direction-type><dynamics><p/></dynamics></direction-type></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration><type>quarter</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>480</duration><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><alter>-1</alter><octave>3</octave></pitch><duration>960</duration><staff>2</staff><notations><technical><fingering>2</fingering></technical></notations></note>
    </measure>
  </part>
</score-partwise>
"""


class MusicXmlTests(unittest.TestCase):
    def test_reads_notes_metadata_chords_and_staff(self):
        score = parse_musicxml(MUSICXML, "fallback")

        self.assertEqual(score["title"], "Test score")
        self.assertEqual(score["composer"], "Test composer")
        self.assertEqual(score["instrument"], "Piano")
        self.assertEqual(score["key"], "D major")
        self.assertEqual(score["meter"], "3/4")
        self.assertEqual([note["pitch"] for note in score["notes"]], ["C4", "E4", "C#3"])
        self.assertEqual([note["beat"] for note in score["notes"]], [0, 0, 1])
        self.assertEqual(score["notes"][0]["dynamic"], "p")
        self.assertEqual(score["notes"][2]["hand"], "L")
        self.assertEqual(score["notes"][2]["finger"], "2")

    def test_reads_compressed_musicxml_container(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr(
                "META-INF/container.xml",
                '<container><rootfiles><rootfile full-path="scores/main.musicxml"/></rootfiles></container>',
            )
            archive.writestr("scores/main.musicxml", MUSICXML)

        self.assertEqual(_extract_musicxml(output.getvalue()), MUSICXML)
        self.assertEqual(parse_musicxml(output.getvalue(), "fallback")["title"], "Test score")

    def test_rejects_non_score_xml(self):
        with self.assertRaisesRegex(ValueError, "partwise"):
            parse_musicxml(b"<not-a-score />", "test")

    def test_converts_musicxml_pitches(self):
        self.assertEqual(_midi_pitch("C", 0, "4"), ("C4", 60))
        self.assertEqual(_midi_pitch("D", -1, "3"), ("C#3", 49))
        self.assertIsNone(_midi_pitch("E", 0.5, "4"))

    def test_preserves_scores_larger_than_the_previous_note_limit(self):
        extra_chord_notes = (
            b"<note><chord/><pitch><step>G</step><octave>4</octave></pitch>"
            b"<duration>480</duration><type>quarter</type></note>"
        ) * 5000
        score = parse_musicxml(MUSICXML.replace(b"</measure>", extra_chord_notes + b"</measure>"), "fallback")

        self.assertEqual(len(score["notes"]), 5003)

    def test_preserves_exported_empty_trailing_measures(self):
        xml = MUSICXML.replace(
            b"</measure>",
            b"</measure><measure number=\"30\"><rest/><duration>960</duration></measure>",
            1,
        )

        score = parse_musicxml(xml, "fallback")

        self.assertEqual(score["measureCount"], 30)

    def test_preserves_custom_time_signatures(self):
        xml = MUSICXML.replace(
            b"<beats>3</beats><beat-type>4</beat-type>",
            b"<beats>17</beats><beat-type>16</beat-type>",
        )

        score = parse_musicxml(xml, "fallback")

        self.assertEqual(score["meter"], "17/16")


class AudiverisTests(unittest.TestCase):
    def test_runs_full_transcription_and_parses_export(self):
        def finish_transcription(command, **_kwargs):
            output = Path(command[command.index("-output") + 1])
            (output / "recognized.musicxml").write_bytes(MUSICXML)
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "score.png"
            source.touch()
            with patch("server.main._audiveris_command", return_value="audiveris"), patch(
                "server.main.subprocess.run", side_effect=finish_transcription
            ) as run:
                score = recognize_score(source, "fallback")

        command = run.call_args.args[0]
        self.assertIn("-transcribe", command)
        self.assertEqual(score["title"], "Test score")

    def test_includes_audiveris_log_when_no_musicxml_is_exported(self):
        def finish_without_export(command, **_kwargs):
            output = Path(command[command.index("-output") + 1])
            (output / "recognition.log").write_text(
                "\n".join((
                    "INFO Audiveris started",
                    "WARN Too few black pixels: 0.00% of whole image. This sheet is almost blank.",
                    "INFO Created scores: []",
                    "INFO Sheet source flagged as invalid.",
                    "INFO Could not export since transcription did not complete successfully.",
                )),
                encoding="utf-8",
            )
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "score.png"
            source.touch()
            with patch("server.main._audiveris_command", return_value="audiveris"), patch(
                "server.main.subprocess.run", side_effect=finish_without_export
            ):
                with self.assertRaisesRegex(ValueError, "Could not export since transcription") as context:
                    recognize_score(source, "fallback")
        self.assertIn("Too few black pixels", str(context.exception))
        self.assertIn("Created scores: []", str(context.exception))


class UploadValidationTests(unittest.TestCase):
    def test_rejects_non_pdf_renamed_as_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "not-a-pdf.pdf"
            path.write_bytes(b"this is a prank image")
            with self.assertRaisesRegex(ValueError, "does not match"):
                _validate_score_signature(path, ".pdf")

    def test_extracts_audio_from_valid_video(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "performance.mp4"
            source.touch()
            probe = SimpleNamespace(
                returncode=0,
                stdout=json.dumps({
                    "format": {"duration": "30.0"},
                    "streams": [{"codec_type": "video"}, {"codec_type": "audio"}],
                }),
                stderr="",
            )

            def run_process(command, **_kwargs):
                if command[0] == "ffprobe":
                    return probe
                Path(command[-1]).write_bytes(b"wav audio")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with patch("server.main.subprocess.run", side_effect=run_process) as run:
                audio = extract_video_audio(source)

            self.assertTrue(audio.is_file())
            self.assertEqual(audio.read_bytes(), b"wav audio")
            self.assertEqual(run.call_count, 2)

    def test_rejects_video_without_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "silent.mp4"
            source.touch()
            probe = SimpleNamespace(
                returncode=0,
                stdout=json.dumps({"format": {"duration": "30.0"}, "streams": [{"codec_type": "video"}]}),
                stderr="",
            )
            with patch("server.main.subprocess.run", return_value=probe):
                with self.assertRaisesRegex(ValueError, "no audio track"):
                    extract_video_audio(source)


class VideoApiTests(unittest.TestCase):
    def test_video_upload_is_transcribed_and_marked_as_video_source(self):
        score = {
            "title": "Performance",
            "instrument": "Piano",
            "tempo": 120,
            "meter": "4/4",
            "key": "C major",
            "measureCount": 1,
            "notes": [{"pitch": "C4", "measure": 1, "beat": 0, "duration": 1, "hand": "R"}],
        }
        with patch("server.main.extract_video_audio", return_value=Path("extracted.wav")) as extract, patch(
            "server.main.transcribe_audio", return_value=(score, {"score": 0.9})
        ) as transcribe:
            with TestClient(app) as client:
                response = client.post(
                    "/api/analyze/video",
                    files={"file": ("performance.mp4", b"video bytes", "video/mp4")},
                    data={"tempo": "120", "meter": "4/4", "instrument": "Piano"},
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"]["kind"], "video")
        extract.assert_called_once()
        transcribe.assert_called_once()

    def test_rejects_analysis_when_another_job_is_using_the_model(self):
        with patch("server.main._analysis_semaphore", asyncio.Semaphore(0)):
            with TestClient(app) as client:
                response = client.post(
                    "/api/analyze/audio",
                    files={"file": ("piece.wav", b"audio bytes", "audio/wav")},
                )

        self.assertEqual(response.status_code, 429)
        self.assertIn("another", response.json()["detail"].lower())


class YouTubeAuthorizationTests(unittest.TestCase):
    def test_youtube_download_requires_authorization_confirmation(self):
        with TestClient(app) as client:
            response = client.post(
                "/api/youtube/download",
                data={"url": "https://www.youtube.com/watch?v=dQw4w9WgXc", "authorized": "false"},
            )

        self.assertEqual(response.status_code, 422)
        self.assertIn("authorized", response.json()["detail"].lower())

    def test_youtube_transcription_requires_authorization_confirmation(self):
        with TestClient(app) as client:
            response = client.post(
                "/api/youtube/transcribe",
                data={"url": "https://www.youtube.com/watch?v=dQw4w9WgXc", "authorized": "false"},
            )

        self.assertEqual(response.status_code, 422)
        self.assertIn("authorized", response.json()["detail"].lower())


class ApiAuthenticationTests(unittest.TestCase):
    def test_analysis_catalog_requires_signed_in_user_when_enabled(self):
        with patch.dict("server.main.os.environ", {"SONORA_REQUIRE_AUTH": "true"}, clear=True):
            with TestClient(app) as client:
                response = client.get("/api/search", params={"q": "piano"})

        self.assertEqual(response.status_code, 401)

    def test_valid_supabase_session_can_use_protected_catalog(self):
        class SupabaseUserClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def get(self, _url, headers):
                self.headers = headers
                return SimpleNamespace(status_code=200)

        with patch.dict("server.main.os.environ", {"SONORA_REQUIRE_AUTH": "true"}, clear=True), patch(
            "server.main.httpx.AsyncClient", return_value=SupabaseUserClient()
        ), patch("server.main._search_musicbrainz", new_callable=AsyncMock, return_value=[]), patch(
            "server.main._search_archive", new_callable=AsyncMock, return_value=[]
        ):
            with TestClient(app) as client:
                response = client.get(
                    "/api/search",
                    params={"q": "piano"},
                    headers={"Authorization": "Bearer valid-session"},
                )

        self.assertEqual(response.status_code, 200)


class ActivationTests(unittest.TestCase):
    def test_scores_the_note_activation_in_its_pitch_and_time_window(self):
        activations = np.zeros((100, 88), dtype=np.float32)
        activations[40:50, 60 - 21] = 0.8
        score = _activation_for_note({"note": activations}, 60, 40 * 256 / 22050, 50 * 256 / 22050)
        self.assertEqual(score, 0.8)

    def test_activation_returns_none_for_out_of_range_pitch(self):
        self.assertIsNone(_activation_for_note({"note": np.zeros((10, 88))}, 110, 0, 0.1))


if __name__ == "__main__":
    unittest.main()
