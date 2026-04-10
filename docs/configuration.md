# Configuration

WhereWeWere reads environment variables from `.env`.

Start from:

```bash
cp .env.example .env
```

## Required in production

- `DATABASE_URL`
- `SESSION_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

## Security hardening

- `CORS_ORIGINS`
  - Comma-separated list of allowed browser origins.
  - Example: `https://journal.example.com,https://www.journal.example.com`
- `API_ACCESS_TOKEN`
  - Optional API token guard.
  - When set, all `/api/v1/*` requests must include `X-WhereWeWere-Token`.
- `TRUST_PROXY`
  - Set to `true` when running behind a reverse proxy.

## Notes

- In development, VAPID keys can be generated automatically.
- In production, startup fails if VAPID keys are missing.
- This project is currently a single-user deployment model.
