# Troubleshooting

## Browser requests fail with CORS errors

Cause: browser origin not included in `CORS_ORIGINS`.

Fix:

1. Add exact origin values including scheme and port.
2. Restart containers.

Example:

`CORS_ORIGINS=https://journal.example.com,http://192.168.1.50:5173`

## API returns 401 Unauthorized / the app keeps showing the sign-in screen

Cause: every `/api/v1/*` request needs a signed-in session (a `wherewewere_session` cookie). The session ended: you signed out, it expired (12 hours idle without "Remember me", 30 days with it), it was revoked from another device, or your password was changed or reset.

Fix:

1. Sign in again.
2. If the cookie never sticks over HTTPS behind a reverse proxy, set `TRUST_PROXY=true` so the server sees the original scheme.
3. Can't sign in at all? See [Accounts → Recovery](accounts.md#recovery-when-no-admin-can-sign-in).

## Sleep as Android / Plex webhooks return 404

Cause: webhook URLs are per user and contain a secret (`/api/v1/webhook/<name>/<secret>`). The old URLs without a secret no longer work, and regenerating the secret in **Settings → Account** invalidates the previous URLs.

Fix: copy the current URL from the plugin's settings into Sleep as Android / Plex.

## Health checks stay pending for a while

Cause: first startup runs migrations.

Fix:

```bash
docker compose logs -f db
docker compose logs -f server
```

Wait until migrations complete and health checks report healthy.

## Confirm effective Compose config

```bash
docker compose config
```

Use this to verify resolved env values and volume mappings.

## Server fails to start with a PostGIS/extension error

Cause: the database is plain Postgres without the PostGIS extension. Migrations create PostGIS types (e.g. for GPS tracks), so the server will not start against a non-PostGIS database.

Fix:

1. Use the stock Compose stack, which runs `postgis/postgis:16-3.4`.
2. If using an external database, enable the PostGIS extension: `CREATE EXTENSION IF NOT EXISTS postgis;`.

## The Record button says the microphone is blocked or unavailable

- Microphone access needs HTTPS or `localhost`. Over plain `http://` on a LAN address the browser refuses; put the app behind a TLS reverse proxy.
- Allow the microphone for the site in the browser's site settings, then reload.
- Another app may be holding the microphone; close it and try again.

## Audio is stuck on "Waiting to be transcribed"

No transcription endpoint is configured, or it is unreachable. Set it in **Settings → Integrations → Audio transcription** and use **Test connection**. For the bundled service, start it with `docker compose --profile transcription up -d` and check `docker compose logs transcription`. The note shows the last error. "Model … is not installed locally" means the service has not finished installing `TRANSCRIPTION_MODEL` (the first start downloads it; follow `docker compose logs -f transcription`) or the model name in Settings differs from it. Waiting audio is processed automatically once the service answers.

## A transcript repeats one word or phrase over and over

Whisper-family models can get stuck in a loop, especially after silence or background noise, and by default each stretch of audio is fed the previous one's text, so the loop continues to the end of the recording. The bundled transcription service is set up to avoid this: the app always asks for voice-activity detection, and the service runs in batched mode (`TRANSCRIPTION_BATCHED_MODE=true`, the default), which transcribes each chunk of speech independently so a loop cannot carry on. As a safety net the app also folds a run of four or more identical segments into one.

If you see it on audio transcribed before these settings:

1. Recreate the service so it picks up batched mode: `docker compose --profile transcription up -d --force-recreate transcription`, and rebuild the server (`docker compose up -d --build server`).
2. Open the note and press **Transcribe again** on the audio file (this replaces the transcript, including any corrections you made).

Other things that help: set a **language hint** in Settings > Integrations > Audio transcription (a wrong automatic guess at the start of a noisy recording can derail the whole file), and make sure `TRANSCRIPTION_BATCHED_MODE` has not been set to `false`. A server log line `Transcript of "…" looped: folded N repeated segments` means the guard caught one.

## A recording is silent (the level meter stays flat)

Some browsers give a silent stream when every voice-processing setting is off. Firefox on Android is the known case: with echo cancellation and noise suppression both off, no sound arrives, while turning either on works. When the app starts a recording with both off, it checks for sound for about a second and a half and, if the stream is dead, retries on its own: first without the channel-count and sample-rate hints (leaving processing off), then with noise suppression on, then with echo cancellation on. The first one that produces sound is used, a note says which, and it is saved for that microphone (and channels switch to **Auto** if the format hints were the problem). **Reset to defaults** in Advanced audio settings undoes it.

If it still stays silent, a message says no sound is coming from the microphone: check it isn't muted or covered, that the browser has microphone permission, and try another microphone. With echo cancellation or noise suppression turned on the check is skipped, because those can legitimately output exact silence in a quiet room.
