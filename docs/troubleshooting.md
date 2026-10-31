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
