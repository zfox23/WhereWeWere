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
| `DATA_DIR` | `<cwd>/data` | Directory for user data files (uploaded GPS tracks, etc.). Docker Compose pins this to `/app/data`, backed by the `./data/server` host directory. |

## Security hardening

- `CORS_ORIGINS`
  - Comma-separated list of allowed browser origins.
  - Example: `https://journal.example.com,https://www.journal.example.com`
  - When unset, CORS enforcement is disabled — fine for local use, not recommended publicly.
- `API_ACCESS_TOKEN`
  - Optional API token guard.
  - When set, all `/api/v1/*` requests must include `X-WhereWeWere-Token` with the exact value.
  - The client is built with this value (via the `VITE_API_ACCESS_TOKEN` build arg), so **rebuild the client and server** whenever you change it.
- `TRUST_PROXY`
  - Set to `true` when running behind a reverse proxy (Traefik, Caddy, Nginx, etc.).

## Notes

- This project is currently a single-user deployment model.
- Integrations (Immich, Maloja, Dawarich, LLM) are configured per-user in the app's **Settings → Integrations** page, not via environment variables.
