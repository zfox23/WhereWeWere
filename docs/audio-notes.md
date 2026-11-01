# Audio notes and transcription

A note can carry any number of audio files. Record from a microphone you choose, or add an existing file (mp3, m4a, wav, ogg, webm, flac, aac), on the **New note** / **Edit note** page. Each file is transcribed on its own, the transcript is searchable like the note's text, and you can play every file back (with a speed control) from the note's page, clicking a line of the transcript to jump to it. A note may be audio only.

## Recording quality

The browser's voice processing (noise suppression, echo cancellation, automatic gain) is **off**, 48 kHz is requested, and the audio is encoded as Opus at 256 kbps for stereo (Safari uses AAC in MP4 at its highest bitrate).

Choose **Mono** or **Stereo** next to the microphone picker (stereo is the default; the choice is remembered per device). Mono is encoded at 128 kbps, the same per channel, so the file is half the size. The browser treats this as a request: a one-channel microphone stays mono under *Stereo*, and you are told when that happens. The server stores exactly the bytes the browser produced; nothing is re-encoded.

Recording needs a **secure context**: HTTPS (see [Deployment](deployment.md#reverse-proxy-behavior)) or `localhost`. Over plain HTTP the browser refuses microphone access.

The microphone and channel choice are remembered per browser/device and survive signing out.

Under **Advanced audio settings** on the recording panel you can change the capture options your browser's media APIs offer: echo cancellation, noise suppression, automatic gain control, voice isolation (where the browser supports it), sample rate and sample size. They are saved **per microphone** on this device, so a USB interface can stay unprocessed while a laptop microphone gets noise suppression. Only what your browser supports is shown. **Check what this microphone supports** opens the microphone for an instant to read its capabilities (a setting the device fixes is locked, and the sample-rate and sample-size choices narrow to what it offers). The defaults are all processing off and 48 kHz, which keeps the most detail. These are requests that browsers and devices may override, so the panel shows what the browser actually applied to your last recording, and a warning appears if it overrode something you chose.

While recording, **Blank screen** covers the app with solid black (handy for a phone on a table or an OLED screen). The recording and the wake lock carry on underneath; **double-tap** (or double-click) the black screen, or press Escape, to return. If the recording is interrupted while the screen is black, the app comes back on its own so you see why.

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

The service ships with no models, so on start it installs the one named by `TRANSCRIPTION_MODEL` (default `Systran/faster-whisper-large-v3`, set in `.env`). The first start downloads it, which is a few GB and takes several minutes; watch `docker compose logs -f transcription`. It is cached in the `whisper_models` Docker volume, so later starts only check that it is there (`docker volume rm wherewewere_whisper_models` frees the space). Use the same model name in **Settings → Integrations → Audio transcription**. The app never installs models itself: if the names don't match, waiting audio shows the service's "model is not installed" error.

Any other OpenAI-compatible transcription server works if you point the URL at it. If audio stays on "Waiting to be transcribed", the note shows the last error; `docker compose logs transcription` has the service's side.

The app folds any run of four or more identical segments into one, as a safety net against a model looping on a phrase. See [Troubleshooting](troubleshooting.md#a-transcript-repeats-one-word-or-phrase-over-and-over) for the batched-mode option and its trade-offs.

Audio waits (status "Waiting to be transcribed") until an endpoint is saved in Settings (the connection test uses what is typed in the form, saved or not); nothing is lost, and it is picked up within a minute of saving. Failures retry with growing delays and then show **Retry**. **Transcribe again** replaces a transcript, including your corrections. Transcripts also feed the notes similarity analysis.

| Variable | Default | Description |
| --- | --- | --- |
| `TRANSCRIPTION_PORT` | `8000` | Host port the optional transcription service publishes. |
| `TRANSCRIPTION_MODEL` | `Systran/faster-whisper-large-v3` | Model the transcription service installs when it starts. Empty installs nothing. |
| `TRANSCRIPTION_BATCHED_MODE` | `false` | Batched decoding stops looping transcripts but needs voice-activity detection (which drops quiet speech) and gives 30-second segments. Leave off unless loops are your main problem. |

## Importing audio files

**Settings → Notes → Import audio files** turns existing recordings into notes. Drag files and folders onto it (folders are searched recursively; only mp3, m4a, aac, wav, flac, ogg/opus and webm are kept, and hidden files are ignored), or use *Choose files* / *Choose folder*. Drop as many batches as you like: every drop adds to one list, and nothing uploads until you press **Import**.

Each file becomes one note with the audio attached. The date comes from the file name:

| File name | Note |
| --- | --- |
| `2023-04-05 14.30.59 Walk in the park.m4a` | Apr 5, 2023 at 2:30:59 pm, titled "Walk in the park" (the time is local time) |
| `2023-04-05 14.30.59.m4a` | same time, no title |
| `2023-04-05 Walk in the park.m4a` | the file's modified time if it falls on that day, else 8 pm |
| `Walk in the park.m4a` | the file's modified time |

The time zone is taken from your check-ins around that date (so a trip is respected); before your first check-in, the fallback zone on the form is used. The review table shows each file's title, date, zone and where each came from; untick anything you don't want. Files whose audio is byte-for-byte identical to audio already on one of your notes are flagged and unticked, whatever they are called, so dropping the same folder twice never creates duplicates. Tags you enter are added to every imported note.

Files upload one at a time, straight from your disk, with the same resumable, checksummed upload as recordings. Transcription starts only when the whole import run has finished. If the page is closed mid-run, files already uploaded are kept; drop the folder again to finish (uploads that already completed are reused rather than sent again), and anything left waiting is released to the transcriber after an hour of inactivity. A file that fails stays in the list so you can retry it.

## Limits

- 1 GB per audio file (about 4 hours at 256 kbps).
- Backups include the original audio and transcripts, so they can be large: restoring accepts up to 20 GB. If you run your own reverse proxy in front of the bundled one, raise its request-size limit for `/api/v1/backup/` and make its timeouts generous.
