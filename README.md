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

- Location check-ins with venue details, notes, and maps
- Mood check-ins with custom Activity support
- Sleep logging with duration calculation
- A Profile page with tons of reflection-worthy stats
- Careful attention to time logic
- Unified timeline across check-ins, mood entries, and sleep entries
- Data import flows (Swarm, Daylio, Sleep as Android)
- Optional integrations with Immich, Maloja, and Dawarich

## Security Scope

WhereWeWere currently behaves as a single-user app.

- It is not a multi-user auth platform yet.
- If you expose it publicly, configure access controls first.
- See [Configuration](docs/configuration.md) for `API_ACCESS_TOKEN`, `CORS_ORIGINS`, and proxy settings.

## Motivation

I used Swarm, Last.fm, Google Location History, Google Photos, and similar services for years. The overwhelming amount of personal history stored by third parties pushed me toward self-hosting.

WhereWeWere is the result of that shift: keep personal context data in systems you control, while still getting rich timeline and reflection features.