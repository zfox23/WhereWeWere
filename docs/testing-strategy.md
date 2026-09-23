# Testing Strategy

This document defines the baseline testing program for this repository.

## Objectives

- Catch regressions in check-in, venue search, timeline, and mood flows before merge.
- Prevent data correctness bugs around timezone handling and coordinate serialization.
- Build confidence with deterministic tests that run locally and in CI.

## Test Pyramid

- Unit tests: Pure logic in utilities and services.
- Integration tests: API routes and multi-module behavior with real dependencies mocked only at external boundaries.
- Contract tests: Response shape and serialization invariants for public APIs.
- End-to-end tests: Critical user journeys across client and server.

## Tooling

- Client: Vitest, jsdom, Testing Library, MSW.
- Server: Vitest, Supertest.
- Integration: Vitest + Supertest against a real Postgres/PostGIS database.
- E2E (next phase): Playwright.

## Current Baseline

- Root scripts orchestrate tests for both workspaces.
- Client test config and setup are enabled.
- Server test config is enabled, plus a separate integration config
  ([`vitest.integration.config.ts`](../server/vitest.integration.config.ts)).
- Unit tests cover geographic distance, venue similarity, LLM compaction,
  timestamp reconciliation, Yamtrack import parsing, media matching helpers,
  and plugin server routes.
- Backend integration tests run against a real PostGIS database (see
  [`server/tests/helpers/testDb.ts`](../server/tests/helpers/testDb.ts)) and
  cover API behavior, plugin check-in flows, backups, and webhooks.

## Directory Conventions

- Client tests: `client/tests/**`.
- Server tests: `server/tests/**`.
- Plugin tests: `plugins/<id>/tests/**` (unit) and `plugins/<id>/tests/integration/**` (integration).
- Use `*.test.ts` or `*.test.tsx` naming.

## Quality Gates

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs on every push and pull request:

1. Install dependencies (`npm ci`).
2. Build (`npm run build`).
3. Run tests (`npm run test`).
4. Run backend integration tests (`npm run test:integration`) against a PostGIS service container.

Local integration test command:

- `npm run test:integration`

Requires a local PostGIS database (by default `postgres://wherewewere:wherewewere@localhost:5432/wherewewere_test`); override with `DATABASE_URL`.

Coverage thresholds are planned next.

## Priority Backlog

1. Add frontend integration tests for VenueSearch, CheckInForm, and Home pagination/date grouping.
2. Add contract tests to lock coordinate number serialization and timezone-sensitive date filtering.
3. Add Playwright smoke journeys for check-in and mood-check-in creation.
4. Enforce per-workspace coverage thresholds in CI.
