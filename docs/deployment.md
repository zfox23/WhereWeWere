# Deployment

This guide covers Docker Compose deployment for persistent, self-hosted operation.

## Security model reminder

WhereWeWere has its own password sign-in, with separate private accounts managed by an administrator (see [Accounts](accounts.md)).

Before exposing it publicly:

- Use HTTPS (session cookies are marked `Secure` when the request arrives over HTTPS; set `TRUST_PROXY=true` behind a reverse proxy)
- Set `NODE_ENV=production`
- Set `CORS_ORIGINS`
- Set a password for the initial admin account (see below) and give every user a strong password
- Consider keeping it behind a VPN or your reverse proxy's access controls anyway: a single self-hosted server is a small target, but defense in depth is cheap

## Services and ports

| Service | Image | Default published port | Purpose |
| --- | --- | --- | --- |
| `db` | `postgis/postgis:16-3.4` | `5432` (`DB_PORT`) | Postgres with PostGIS. PostGIS is required for GPS tracks. |
| `server` | built from [`server/Dockerfile`](../server/Dockerfile) | `3001` (`SERVER_PORT`) | Express API; runs migrations on startup; health check at `/healthz`. |
| `client` | built from [`client/Dockerfile`](../client/Dockerfile) | `5173` (`CLIENT_PORT`) | Nginx serving the built PWA; proxies `/api/*` to the server. |

The client Nginx proxy forwards `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` to the server, and allows request bodies up to 500 MB (backup restore and large imports).

## Build and run

```bash
docker compose up -d --build
```

## First sign-in

A new install has one administrator account, `default`, with no usable password (an install upgraded from the single-user version keeps its existing account and username instead). Set one (it prints a temporary password you replace at first sign-in):

```bash
docker compose exec server node dist/server/src/scripts/set-password.js default --generate
```

Then sign in, choose your own password, and optionally rename the account under **Settings → Account**. Add other people under **Settings → Users**. See [Accounts](accounts.md).

## Verify health

```bash
docker compose ps
docker compose logs -f db
docker compose logs -f server
docker compose logs -f client
```

## Reverse proxy behavior

If behind Traefik/Caddy/Nginx, set:

```env
TRUST_PROXY=true
```

Serve the app over HTTPS: browsers only allow microphone access (audio notes) and notifications (Web Push) on HTTPS or `localhost`. If your proxy sits in front of the bundled nginx, allow large request bodies on `/api/v1/backup/` (restoring a backup that includes audio can be many GB) and use long timeouts there. See [Audio notes](audio-notes.md).

## Notifications

Notifications are sent by the server with Web Push, so they arrive on a phone even when the installed app is closed. Each person turns them on per device in **Settings > Notifications**, then turns on each feature that offers them (e.g. Mood check-in reminders). Nothing is on by default.

- The server needs outbound HTTPS to the browsers' push services (e.g. `fcm.googleapis.com` for Chrome on Android, `*.push.services.mozilla.com`, `*.push.apple.com`).
- The VAPID key pair is generated on first start and stored in the database (`server_secrets`), so backups of the database keep it. `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` override it; changing the pair turns notifications off on every device until they're turned on again.
- Scheduled reminders use each device's own timezone, which the app updates whenever it opens.
- On iPhone/iPad, notifications only work after adding the app to the Home Screen.

## Persistence

By default, Docker Compose uses direct appdata path mapping for database files. To instead use the named Docker volume `postgres_data` for database persistence, swap the commented lines under `volumes` in the `db` service definition, like this:

```yaml
    volumes:
      #- ./data/postgres:/var/lib/postgresql/data
      - postgres_data:/var/lib/postgresql/data
```

Uploaded files (GPS track originals, note audio, etc.) live under `./data/server` on the host (`/app/data` in the server container). Back up that directory in addition to the database if you want a complete picture of your data — or use the in-app backup/restore feature, which bundles both database rows and plugin files into a single ZIP.

## Update workflow

```bash
git pull
docker compose up -d --build
```

Migrations run automatically on server startup; no manual migration step is needed.

## Backup and restore

The app has a built-in **Settings → Data → Backup & Restore** feature that exports everything (all check-in types, settings, uploaded files) to a single ZIP, and can restore from it.

For a database-only backup:

```bash
docker compose exec db pg_dump -U wherewewere wherewewere > wherewewere-backup.sql
```

Restore:

```bash
docker compose exec -T db psql -U wherewewere wherewewere < wherewewere-backup.sql
```

Note that a `pg_dump` restore does not include files under `./data/server`; restore those from your own file backup if needed.
