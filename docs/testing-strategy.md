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
- E2E (next phase): Playwright.

## Current Baseline

- Root scripts orchestrate tests for both workspaces.
- Client test config and setup are enabled.
- Server test config is enabled.
- Baseline tests exist for geographic distance and venue similarity logic.

## Directory Conventions

- Client tests: `client/tests/**`.
- Server tests: `server/tests/**`.
- Use `*.test.ts` or `*.test.tsx` naming.

## Quality Gates

CI runs on every push and pull request:

1. Install dependencies (`npm ci`).
2. Build (`npm run build`).
3. Run tests (`npm run test`).

Local integration test command:

- `npm run test:integration`

Coverage thresholds and integration DB tests are planned next.

## Priority Backlog

1. Add backend integration tests for check-ins, venues, and mood-checkins with a test database.
2. Add frontend integration tests for VenueSearch, CheckInForm, and Home pagination/date grouping.
3. Add contract tests to lock coordinate number serialization and timezone-sensitive date filtering.
4. Add Playwright smoke journeys for check-in and mood-check-in creation.
5. Enforce per-workspace coverage thresholds in CI.
