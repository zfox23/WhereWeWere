# Unraid Deployment

This guide documents Docker Compose deployment of WhereWeWere on Unraid.

## 1. Place project under appdata

Example location:

`/mnt/user/appdata/wherewewere`

```bash
cd /mnt/user/appdata
git clone https://github.com/zfox23/WhereWeWere.git wherewewere
cd wherewewere
cp .env.example .env
```

## 2. Configure required values

Set in `.env`:

- `SESSION_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Recommended:

- `API_ACCESS_TOKEN`
- `CORS_ORIGINS` for your Unraid hostname or domain

## 3. Start containers

```bash
docker compose up -d --build
```

Access:

- `http://<unraid-ip>:5173`

## 4. Storage options

By default, Docker Compose uses direct appdata path mapping for database files. To instead use the named Docker volume `postgres_data` for database persistence, swap the commented lines under `volumes` in the `db` service definition, like this:

```yaml
    volumes:
      #- ./data/postgres:/var/lib/postgresql/data
      - postgres_data:/var/lib/postgresql/data
```

## 5. Update workflow on Unraid

```bash
cd /mnt/user/appdata/wherewewere
git pull
docker compose up -d --build
```

## 6. Common Unraid issues

### Permission errors on mounted folders

Ensure Docker has read and write access to your selected appdata path.

### Port conflicts on 5173 or 3001

Change published ports in `docker-compose.yml`.

### API requests return unauthorized

If `API_ACCESS_TOKEN` is set, rebuild after env changes and ensure clients send `X-WhereWeWere-Token`.
