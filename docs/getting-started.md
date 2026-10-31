# Getting Started

This guide is the fastest way to run WhereWeWere locally with Docker Compose.

## Prerequisites

- Docker Engine with Docker Compose plugin
- Git

No other prerequisites are needed — the Compose stack provides its own Postgres/PostGIS database and builds the server and client images for you.

## 1. Clone the repository

```bash
git clone https://github.com/zfox23/WhereWeWere.git
cd WhereWeWere
```

## 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and set:

- `SESSION_SECRET` to a long random value

## 3. Start the stack

```bash
docker compose up -d --build
```

## 4. Verify services

```bash
docker compose ps
docker compose logs -f server
```

Open:

- App: `http://localhost:5173`
- API health: `http://localhost:3001/healthz`

## 5. Sign in

A new install has one administrator account, `default`, with no usable password yet. Set a temporary one:

```bash
docker compose exec server node dist/server/src/scripts/set-password.js default --generate
```

Sign in at `http://localhost:5173` with `default` and the printed password, then choose your own password. You can rename the account under **Settings → Account** and add other people under **Settings → Users**. See [Accounts & Sign-in](accounts.md).

## 6. Stop services

```bash
docker compose down
```

## Next steps

- Configure security and integrations in [Configuration](configuration.md).
- Manage users, sessions and webhook URLs: [Accounts & Sign-in](accounts.md).
- For internet-facing deployment, continue to [Deployment](deployment.md).
- For Unraid-specific setup, use [Unraid Deployment](unraid.md).
