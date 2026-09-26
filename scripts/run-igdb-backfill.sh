#!/usr/bin/env bash
# ============================================================================
# Run the games-to-IGDB backfill against the dockerized production database.
#
# What it does:
#   1. Rebuilds the server image (so migration 050 and the compiled backfill
#      script are current).
#   2. Ensures db + server are up; the server applies pending migrations
#      (including 050_igdb_external_source) on boot.
#   3. Runs the backfill in a one-off server container:
#         node dist/plugins/media/scripts/backfill-games-to-igdb.js [--dry-run]
#
# Prereq: the IGDB Twitch Client ID / Client Secret must already be saved in
# the app (Settings > Media > IGDB). Without them the script exits with an
# error before touching anything.
#
# Usage:
#   ./scripts/run-igdb-backfill.sh --dry-run   # plan only, no writes
#   ./scripts/run-igdb-backfill.sh             # apply
#
# A backup is recommended before the first real run (Settings page has a full
# backup export, or: docker compose exec db pg_dump -U wherewewere wherewewere > backup.sql)
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN_ARGS=()
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN_ARGS=("--dry-run")
fi

echo "==> Building server image (includes migration 050 + backfill script)"
docker compose build server

echo "==> Ensuring database is up and healthy"
docker compose up -d db
for _ in $(seq 1 60); do
  status="$(docker compose ps --format '{{.Health}}' db 2>/dev/null || true)"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
if [[ "$(docker compose ps --format '{{.Health}}' db 2>/dev/null || true)" != "healthy" ]]; then
  echo "error: database never became healthy" >&2
  exit 1
fi

echo "==> Starting server (applies pending migrations on boot)"
docker compose up -d server
for _ in $(seq 1 60); do
  status="$(docker compose ps --format '{{.Health}}' server 2>/dev/null || true)"
  [[ "$status" == "healthy" ]] && break
  sleep 2
done
if [[ "$(docker compose ps --format '{{.Health}}' server 2>/dev/null || true)" != "healthy" ]]; then
  echo "error: server never became healthy (check: docker compose logs server)" >&2
  exit 1
fi

echo "==> Running games-to-IGDB backfill${DRY_RUN_ARGS[*]:+ (dry run)}"
docker compose run --rm server node dist/plugins/media/scripts/backfill-games-to-igdb.js "${DRY_RUN_ARGS[@]}"

echo
if [[ ${#DRY_RUN_ARGS[@]} -gt 0 ]]; then
  echo "Dry run complete — nothing was written."
  echo "Review the list above, then re-run without --dry-run to apply."
else
  echo "Backfill applied. Re-running the script is idempotent (no-op on a second pass)."
fi
