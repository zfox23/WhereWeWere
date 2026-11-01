# Audio notes and transcription

A note can carry any number of audio files. Record from a microphone you choose, or add an existing file (mp3, m4a, wav, ogg, webm, flac, aac), on the **New note** / **Edit note** page. Each file is transcribed on its own, the transcript is searchable like the note's text, and you can play every file back (with a speed control) from the note's page, clicking a line of the transcript to jump to it. A note may be audio only.

## Recording quality

The browser's voice processing (noise suppression, echo cancellation, automatic gain) is **off**, 48 kHz is requested, and the audio is encoded as Opus at 256 kbps (Safari uses AAC in MP4 at its highest bitrate). The server stores exactly the bytes the browser produced; nothing is re-encoded.

Recording needs a **secure context**: HTTPS (see [Deployment](deployment.md#reverse-proxy-behavior)) or `localhost`. Over plain HTTP the browser refuses microphone access.

The microphone you pick is remembered per browser/device and survives signing out.

## What protects a recording

- Every second of audio is written to the browser's own storage (IndexedDB) as it is recorded. A crashed tab, a closed window or a dead battery loses at most about a second; the recording is offered back, already saved, the next time you open the app.
- Uploads are chunked and resumable, checked with a SHA-256 checksum, and retried automatically (and when the connection returns). The copy on your device is deleted only after the server has verified its copy.
- Saving a note never waits for an upload; audio still uploading attaches to the note when it finishes.
- Signing out never silently discards unsent recordings: you are asked first, and they stay on the device, tied to your account, until they upload.
- Screen wake lock keeps the screen on while recording. **Browsers and phones may still pause a recording when the screen is turned off or the app is in the background** (iOS Safari in particular). If that happens the recording up to that point is kept and you can continue in a new one.

## Transcription (optional)

Transcription runs on your own machine through an OpenAI-compatible `/audio/transcriptions` endpoint. Docker Compose ships an optional service for it (faster-whisper, NVIDIA GPU) that is **not started by default**:

```bash
docker compose --profile transcription up -d
```

Then open **Settings → Integrations → Audio transcription**, enter the URL (`http://transcription:8000/v1` from the server container), the model (for example `Systran/faster-whisper-large-v3`), optionally an API key and a language hint (blank detects the language), and use **Test connection**.

> The Compose service definition has not been run end to end: the image exists, but the model name, cache path and GPU settings are unverified. Check `docker compose logs transcription` on first start. Any other OpenAI-compatible transcription server works if you point the URL at it.

Audio waits (status "Waiting to be transcribed") until an endpoint is configured; nothing is lost. Failures retry with growing delays and then show **Retry**. **Transcribe again** replaces a transcript, including your corrections. Transcripts also feed the notes similarity analysis.

| Variable | Default | Description |
| --- | --- | --- |
| `TRANSCRIPTION_PORT` | `8000` | Host port the optional transcription service publishes. |

## Limits

- 1 GB per audio file (about 4 hours at 256 kbps).
- Backups include the original audio and transcripts, so they can be large: restoring accepts up to 20 GB. If you run your own reverse proxy in front of the bundled one, raise its request-size limit for `/api/v1/backup/` and make its timeouts generous.
