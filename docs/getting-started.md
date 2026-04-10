# Getting Started

This guide is the fastest way to run WhereWeWere locally with Docker Compose.

## Prerequisites

- Docker Engine with Docker Compose plugin
- Git

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
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Generate VAPID keys:

```bash
npx web-push generate-vapid-keys
```

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

## 5. Stop services

```bash
docker compose down
```

## Next steps

- Configure security and integrations in [Configuration](configuration.md).
- For internet-facing deployment, continue to [Deployment](deployment.md).
- For Unraid-specific setup, use [Unraid Deployment](unraid.md).
