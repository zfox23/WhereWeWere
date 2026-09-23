# WhereWeWere

WhereWeWere is a privacy-first, self-hosted life journal.

It helps you record where you were, how you felt, and how you slept, then browse everything in one timeline on infrastructure you control.

## Documentation

- [Getting Started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Deployment](docs/deployment.md)
- [Unraid Deployment](docs/unraid.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Testing Strategy](docs/testing-strategy.md)

## Features

- Location check-ins with venue details, notes, and maps (Overpass/Nominatim venue search)
- Mood check-ins with custom Activity support
- Sleep logging with duration calculation, including a Sleep as Android webhook
- GPS track import (PostGIS-backed) with activity type, distance, and duration
- Media check-ins for movies, TV shows (with episode tracking), games, books, and board games, with TMDB/TheGamesDB/Hardcover metadata
- A Profile page with reflection-worthy stats, plus LLM-assisted reflection summaries
- Unified timeline across all check-in types
- Data import flows (Swarm, Daylio, Sleep as Android, Yamtrack) and a Plex scrobble webhook
- Optional integrations with Immich, Maloja, Dawarich, and any LLM-compatible API
- Installable PWA for mobile and desktop
- Full backup & restore (JSON and ZIP bundles, including uploaded files)

## Security Scope

WhereWeWere currently behaves as a single-user app.

- It is not a multi-user auth platform yet.
- If you expose it publicly, configure access controls first.
- See [Configuration](docs/configuration.md) for `API_ACCESS_TOKEN`, `CORS_ORIGINS`, and proxy settings.

## Motivation

I used Swarm, Last.fm, Google Location History, Google Photos, and similar services for years. The overwhelming amount of personal history stored by third parties pushed me toward self-hosting.

WhereWeWere is the result of that shift: keep personal context data in systems you control, while still getting rich timeline and reflection features.

## Architecture

WhereWeWere is an npm-workspaces monorepo with three packages:

- `shared` — types and plugin manifests shared by client and server
- `server` — Express API backed by Postgres/PostGIS (migrations run automatically on startup)
- `client` — React + Vite PWA served by Nginx, with Leaflet maps

Check-in types are **plugins** under `plugins/` (currently: `location`, `mood`, `sleep`, `tracks`, `media`). Each plugin ships a shared manifest plus client and server halves, and is registered in the client/server registries to contribute timeline entries, forms, profile tabs, data settings, and its own API routes.

## Development

Requires Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` and a local Postgres with PostGIS enabled.

```bash
npm install
cp .env.example .env   # point DATABASE_URL at a PostGIS database
npm run dev            # builds shared, then runs server and client concurrently
```

- Client: `http://localhost:5173` (Vite dev server; `/api` is proxied to the server)
- Server: `http://localhost:3001` (health check at `/healthz`)

Testing:

```bash
npm run test            # client + server unit tests
npm run test:integration  # backend integration tests (requires a test database)
```

See [Testing Strategy](docs/testing-strategy.md) for details.
