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

Recommended:

- `CORS_ORIGINS` for your Unraid hostname or domain

## 3. Start containers

```bash
docker compose up -d --build
```

Access:

- `http://<unraid-ip>:5173`

Before the first sign-in, set the initial admin account's password (see [Accounts](accounts.md#first-sign-in)). On a new install the account is `default`; on an install upgraded from the single-user version, use your existing username:

```bash
docker compose exec server node dist/server/src/scripts/set-password.js default --generate
```

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

### Locked out / forgot the admin password

Reset it from the Unraid terminal (see [Accounts → Recovery](accounts.md#recovery-when-no-admin-can-sign-in)):

```bash
docker compose exec server node dist/server/src/scripts/set-password.js <username> --generate
```
