# Troubleshooting

## Server fails on startup with VAPID error

Cause: missing `VAPID_PUBLIC_KEY` or `VAPID_PRIVATE_KEY` in production.

Fix:

1. Generate keys with `npx web-push generate-vapid-keys`.
2. Add both keys to `.env`.
3. Restart with `docker compose up -d --build`.

## Browser requests fail with CORS errors

Cause: browser origin not included in `CORS_ORIGINS`.

Fix:

1. Add exact origin values including scheme and port.
2. Restart containers.

Example:

`CORS_ORIGINS=https://journal.example.com,http://192.168.1.50:5173`

## API returns 401 Unauthorized

Cause: `API_ACCESS_TOKEN` is enabled and request is missing `X-WhereWeWere-Token`.

Fix:

1. Confirm token value in `.env`.
2. Rebuild client/server if token changed.
3. Ensure custom clients send the header.

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
