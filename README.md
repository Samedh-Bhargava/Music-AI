# Sonora Music Score Studio

Sonora is a local-first score editor with an optional Python service for score recognition, audio transcription, music-catalog search, and YouTube metadata.

## Run the full app

The recommended setup is Docker Desktop with Docker Compose:

1. Open a terminal in this folder.
2. Run `docker compose up --build`.
3. Open `http://localhost:8000`.

The first build downloads Python dependencies, the Basic Pitch model package, and the Audiveris installer. Audio inference runs locally on the server CPU and can take time; a GPU is not required. The compose port is bound to the local computer only by default.

Open `index.html` directly if you only need the score editor. To connect it to an already-running server, choose **Analyze → Server URL**, enter the server URL, and select **Save & check connection**.

## Included features

- Create, edit, play, and save scores in this browser.
- Enter notes or import/export MusicXML and Sonora JSON.
- Import score photographs or PDFs. The server calls the Audiveris OMR command-line application and imports its MusicXML output.
- Transcribe WAV, MP3, M4A, FLAC, OGG, and AIFF files with Spotify Basic Pitch. For best results, use a recording of one prominent instrument, under 10 minutes and 25 MB.
- Estimate measure timing using the tempo and meter selected in the Analyze dialog; notes are quantized to quarter-beat subdivisions.
- Search recording and public archive catalogs through MusicBrainz and the Internet Archive.
- Preview a YouTube video using its official embed and metadata endpoint.

MusicBrainz and Internet Archive searches require an internet connection. Catalog results point to their original sources; check rights and availability there. YouTube preview does not download or transcribe YouTube audio. Upload an audio file you have the right to use for transcription.

## Confidence and limitations

Audio note scores show mean Basic Pitch model activation. This is an uncalibrated review aid, **not** a probability that a note is correct. Audiveris's MusicXML export does not supply calibrated confidence values, so sheet recognition is explicitly marked as unscored. Review recognized scores before relying on them.

The app does not separate orchestral sources, perform harmonic verification with a generative AI, infer fingering automatically, or retrieve full copyrighted scores. Chord labels and instrument-range checks in the editor are basic rule-based helpers.

## Deployment and privacy

Uploaded image, PDF, and audio files are processed by the configured Sonora server and removed from its temporary directory after the request. Scores in the browser are saved in that browser's local storage; use **Export → Download Sonora backup (.json)** for a portable copy.

The Compose file binds only to `127.0.0.1`. Before exposing a server outside your computer:

1. Set a long, unique `SONORA_API_TOKEN` in your deployment environment.
2. Put the service behind HTTPS and an authenticated reverse proxy.
3. Change the Compose port binding to the interface your host requires.
4. Configure that server URL and access token in the app. The token is stored in the current browser tab's session storage.

Do not expose an unauthenticated analysis server to the public internet. The app allows cross-origin requests for local-file use; the API token is therefore important for a public deployment.

## Model versions and licenses

The container uses Python 3.11, Basic Pitch 0.4.0, and the official Audiveris 5.7.0 Ubuntu 22.04 package. Basic Pitch is Apache-2.0; Audiveris is AGPL-3.0-or-later. Review their licenses and source-distribution obligations before redistributing a container that includes either program.
