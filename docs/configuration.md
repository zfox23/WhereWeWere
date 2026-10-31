# Configuration

WhereWeWere reads environment variables from `.env` in the repository root.

Start from:

```bash
cp .env.example .env
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | — (required in production) | Postgres connection string. The database must be Postgres **with PostGIS** (the Docker Compose stack uses `postgis/postgis`). |
| `SESSION_SECRET` | — (required in production) | Secret used for session/crypto operations. Use a long random value. |
| `DB_PORT` | `5432` | Port the Postgres container publishes (Docker Compose). |
| `SERVER_PORT` | `3001` | Port the API server publishes (Docker Compose). |
| `CLIENT_PORT` | `5173` | Port the client (Nginx) publishes (Docker Compose). |
| `NODE_ENV` | `development` | `development` or `production`. Set to `production` for internet-facing deployments. |
| `PHOTON_URL` | project author's instance | Base URL of the [Photon](https://github.com/komoot/photon) geocoder used for reverse geocoding and place search. Venue coordinates are sent to this host: set it to your own instance or a public one (e.g. `https://photon.komoot.io`). |
| `DATA_DIR` | `<cwd>/data` | Directory for user data files (uploaded GPS tracks, etc.). Docker Compose pins this to `/app/data`, backed by the `./data/server` host directory. |

## Security hardening

- `CORS_ORIGINS`
  - Comma-separated list of allowed browser origins.
  - Example: `https://journal.example.com,https://www.journal.example.com`
  - When unset, no cross-origin access is granted (same-origin only), which is what the bundled nginx proxy and the Vite dev proxy need. Set it only if a browser app on a different origin calls the API directly.
- `TRUST_PROXY`
  - Set to `true` when running behind a reverse proxy (Traefik, Caddy, Nginx, etc.), so the server sees the client's real IP (sign-in throttling, the devices list) and HTTPS (the session cookie is then marked `Secure`).
- Accounts
  - Every API request requires a signed-in user; there is no shared API token. Accounts, sessions and recovery are described in [Accounts](accounts.md).

## Notes

- Each account's data is private to it. Integrations (Immich, Dawarich, LLM, and the plugins' API keys) are configured per user in the app's **Settings** pages, not via environment variables.
