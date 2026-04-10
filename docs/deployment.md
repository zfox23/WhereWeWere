# Deployment

This guide covers Docker Compose deployment for persistent, self-hosted operation.

## Security model reminder

WhereWeWere is currently designed as a single-user application.

Before exposing it publicly:

- Use HTTPS
- Set `API_ACCESS_TOKEN`
- Set `CORS_ORIGINS`
- Place the app behind a reverse proxy auth layer or VPN

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

The client Nginx proxy forwards:

- `Host`
- `X-Real-IP`
- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Forwarded-Host`

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

## Update workflow

```bash
git pull
docker compose up -d --build
```

## Backup and restore

Backup:

```bash
docker compose exec db pg_dump -U wherewewere wherewewere > wherewewere-backup.sql
```

Restore:

```bash
docker compose exec -T db psql -U wherewewere wherewewere < wherewewere-backup.sql
```
