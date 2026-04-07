# WhereWeWere

*WhereWeWere* is a Web application for mindfully journaling our presence as we move through life.

## Integrations

WhereWeWere integrates with:

- Immich, to show photos relevant to a check-in's location and time.
- Maloja, to show musical scrobbles relevant to a check-in's time.
- Dawarich, to show specific location history data associated with a given day or time around a checkin.

## Docker Deployment Notes

When running with Docker Compose in production mode, the server requires push notification VAPID keys.

Set these values in your `.env` file before running `docker compose up -d`:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

If either key is missing, the server will fail fast on startup and the client may show a `502` while proxying `/api`.

## Testing

Baseline automated testing is now set up for both workspaces.

- Run all tests: `npm run test`
- Run client tests only: `npm run test --workspace=client`
- Run server tests only: `npm run test --workspace=server`
- Run backend integration tests: `npm run test:integration`
- Run coverage for both workspaces: `npm run test:coverage`

Integration tests require a dedicated database whose name includes `test`.
By default, the server integration command uses:

- `postgres://wherewewere:wherewewere@localhost:5432/wherewewere_test`

Testing standards and implementation roadmap are documented in `docs/testing-strategy.md`.

## Motivation

I've been using Foursquare Swarm, Last.fm, Google Location History, Google Photos, and other similar services since ~2010, and it's starting to scare me how much data third parties have on me. That fear remains even though I've allowed those parties to have that data.

I've begun a technological exodus, leaving third-party applications behind in exchange for self-hosted apps. This not always be the most economical choice, especially with hard drive prices skyrocketing, but it feels safer and more educational.

On March 27, 2026, I purchased one month of Claude Code Pro in an attempt to vibe code a Swarm replacement. I also want to integrate data from other systems I've used for the past several years. This repository is the result of that experiment.

## TODO as of 2026-04-02

### Third Task
When navigating from the home page to a different page (like a checkin detail page or the Profile page) and then back to the home page, my vertical scroll position is reset. Please add a feature to preserve my vertical scroll location when navigating between those pages.

### 4
Map should be full width of the screen on checkins detail and venue pages. Also show map on checkin page after selecting location.

### Fourth Task
Delete all mood checkins that don't have a time zone. Make sure that the Daylio import process also imports time zone information from the `.daylio` file.

### 5
I want Mood Checkin Cards to show their original time zones, too. For example, I'm seeing mood checkins made while in Lisbon show up in EDT on my Home feed. Please fix this. Do not infer time zones from nearby location checkins. Use the time zone information included in the Mood checkins.

###

During import, I'm getting `Entry error: Invalid time zone specified: Etc/GMT-16`. I think Daylio incorrectly recorded some timeZoneOffset values. I believe `"timeZoneOffset": 57600000` corresponds to Pacific Daylight Time. I believe "timeZoneOffset": 54000000` corresponds to Eastern Standard Time.