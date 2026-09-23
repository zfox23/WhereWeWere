# Deployment

This guide covers Docker Compose deployment for persistent, self-hosted operation.

## Security model reminder

WhereWeWere is currently designed as a single-user application.

Before exposing it publicly:

- Use HTTPS
- Set `NODE_ENV=production`
- Set `API_ACCESS_TOKEN`
- Set `CORS_ORIGINS`
- Place the app behind a reverse proxy auth layer or VPN

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

## Persistence

By default, Docker Compose uses direct appdata path mapping for database files. To instead use the named Docker volume `postgres_data` for database persistence, swap the commented lines under `volumes` in the `db` service definition, like this:

```yaml
    volumes:
      #- ./data/postgres:/var/lib/postgresql/data
      - postgres_data:/var/lib/postgresql/data
```

Uploaded files (GPS track originals, etc.) live under `./data/server` on the host (`/app/data` in the server container). Back up that directory in addition to the database if you want a complete picture of your data — or use the in-app backup/restore feature, which bundles both database rows and plugin files into a single ZIP.

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
