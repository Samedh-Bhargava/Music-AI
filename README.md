# Sonora Music Score Studio

Sonora is a score editor with optional local AI processing and opt-in Supabase accounts for cloud score sync.

## Run the full app

The recommended setup is Docker Desktop with Docker Compose:

1. Open a terminal in this folder.
2. Run `docker compose up --build`.
3. Open `http://localhost:8000`.

The first build downloads Python dependencies, the Basic Pitch model package, and the Audiveris installer. Audio inference runs locally on the server CPU and can take time; a GPU is not required. The compose port is bound to the local computer only by default.

Open `index.html` directly if you only need the score editor. The analysis server address is not user-configurable; when served by Docker or a hosted deployment, the app connects to that same server.

## Included features

- Create, edit, play, and save scores in this browser.
- Sign in with email/password through Supabase Auth and sync a merged score library across devices.
- Delete scores from **My scores**; the starter example is added only when a browser has no saved library yet, so deleting the last score stays deleted.
- Practice a selected measure range with left-hand/right-hand filtering, slower playback, repeat, and individual note previews.
- Toggle the score preview between standard note symbols and written pitch names. The preference is saved in this browser.
- Choose synthesized piano, guitar, violin, flute, or synth-style playback for each score. These are Web Audio tones, not sampled instrument recordings.
- Playback follows notes across the entire score, including measures with no notes at the end.
- Enter notes or import/export MusicXML and Sonora JSON.
- Import score photographs or PDFs. The server calls the Audiveris OMR command-line application and imports its MusicXML output.
- MusicXML import preserves all instrument parts and exported measures, including empty trailing measures. The editor currently combines parts into one editable note list, so part identity and separate instrument playback are not retained.
- Transcribe WAV, MP3, M4A, FLAC, OGG, and AIFF audio files with Spotify Basic Pitch using stricter onset/frame and note-length settings. There is no application-defined duration or file-size cutoff; available server storage, memory, and host limits remain the practical boundary.
- The Studio has no application-defined note or measure cap. The **Measures** field supports free-handed completion of incomplete recognition results or scores with skipped/resting passages.
- Heavy score/audio/video analysis runs one job at a time to limit memory pressure. If another job is active, Sonora returns a clear “try again shortly” message instead of queuing more work.
- Cloud requests have a 15-second timeout and analysis requests have a 15-minute browser timeout. If an individual saved score is damaged, it is skipped without preventing the other scores from loading.
- Transcribe user-provided MP4, MOV, M4V, MKV, WebM, and AVI performance videos by extracting their audio locally with FFmpeg. There is no application-defined duration or file-size cutoff.
- Estimate measure timing using the tempo and meter selected in the Analyze dialog; notes are quantized to quarter-beat subdivisions.
- Search recording and public archive catalogs through MusicBrainz and the Internet Archive.
- Preview a YouTube video using its official embed and metadata endpoint.
- Authorized YouTube links can also be downloaded or transcribed directly by **Discover**. The app requires an explicit owner/authorization confirmation and does not bypass restrictions or paid/copyright-protected content.
- Start an audio/video-to-score transcription from **Discover**. Choose a file you have the right to use. The server rejects mislabeled score files, unreadable score pages, videos without audio, and recordings with no detected notes. This is format and transcription validation, not an intent detector for prank/troll uploads.

MusicBrainz and Internet Archive searches require an internet connection. Catalog results point to their original sources; check rights and availability there. Authorized YouTube downloads/transcriptions require the explicit confirmation shown in Discover. Sonora does not bypass paywalls or restrictions. Video processing uses FFmpeg and yt-dlp, included in the Docker image.

## Accounts and cloud sync

The Supabase project URL and public publishable key are configured in the app code, so users do not need to enter developer settings. The public key is intended to be visible to browsers; it is not a secret. The library table uses row-level security to restrict data to each signed-in account. Never place a Supabase secret/service-role key in the frontend.

The Sonora account is separate from the Supabase dashboard account. Create or sign into a Sonora account using **Sign in**. Existing local scores merge into the account library, and edits and deletions sync automatically. **Sync now** also checks for changes made on another device. Cloud sync stores structured score data, not uploaded audio, video, or sheet files.

## Confidence and limitations

Audio note scores show mean Basic Pitch model activation. This is an uncalibrated review aid, **not** a probability that a note is correct. Audiveris's MusicXML export does not supply calibrated confidence values, so sheet recognition is explicitly marked as unscored. Review recognized scores before relying on them.

Polyphonic transcription is an estimate, not a guaranteed exact score. Dense ensemble mixes, overlapping instruments, reverberation, and an incorrect tempo or meter can cause missed, merged, or misaligned notes. The supplied tempo and meter determine how audio events are assigned to measures; review those settings and the resulting notes before exporting. For best results, use a clear recording with one prominent instrument.

The app does not separate orchestral sources, perform harmonic verification with a generative AI, infer fingering automatically, or retrieve full copyrighted scores. Chord labels and instrument-range checks in the editor are basic rule-based helpers.

## Deployment and privacy

Uploaded image, PDF, audio, and video files are processed by the configured Sonora server and removed from its temporary directory after the request. Without a cloud account, scores are saved in browser local storage. With Supabase configured, score data is also stored in the signed-in account’s cloud library. Use **Export → Download Sonora backup (.json)** for a portable copy.

The browser app and API are served from the same origin; cross-origin API calls are not enabled. Opening `index.html` directly is supported for score editing, but use the server URL for analysis and cloud-backed features. A damaged top-level local-storage library is not automatically replaced with the starter score; an unreadable individual score is skipped while the remaining library stays available.

The Compose file binds only to `127.0.0.1`. Before exposing a server outside your computer:

1. Set `SONORA_REQUIRE_AUTH=true` in the deployment environment. This makes analysis and catalog endpoints verify the signed-in Supabase session.
2. Put the service behind HTTPS and configure the Supabase Auth site URL/redirect allowlist for the public site URL.
3. Configure host-level request limits and an always-on container with enough memory and CPU for Basic Pitch and Audiveris.
4. Do not expose an unauthenticated analysis server to the public internet. The in-app developer controls are removed; the frontend uses its same-origin server.

The browser-facing Supabase publishable key is intentionally public and is not an authentication secret. The hosted backend checks Supabase access tokens when `SONORA_REQUIRE_AUTH=true`; keep the service behind HTTPS and apply request-size/rate limits at the host.

## Model versions and licenses

The container uses Python 3.11, Basic Pitch 0.4.0, and the official Audiveris 5.7.0 Ubuntu 22.04 package. Basic Pitch is Apache-2.0; Audiveris is AGPL-3.0-or-later. Review their licenses and source-distribution obligations before redistributing a container that includes either program.
