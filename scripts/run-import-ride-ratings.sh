#!/usr/bin/env bash
# ============================================================================
# Run the ride-ratings import against the dockerized production database.
#
# What it does:
#   1. Rebuilds the server image (so the compiled import-ride-ratings script
#      is current).
#   2. Ensures db + server are up; the server applies pending migrations
#      on boot.
#   3. Runs the import in a one-off server container:
#         node dist/plugins/location/scripts/import-ride-ratings.js --user <name> [--dry-run] [csv-path]
#    --user (required) names the account whose data the import changes.
#
# The CSV path is resolved INSIDE the container. The server container mounts
# ./data/server -> /app/data, so place the CSV in ./data/server/ on the host
# and pass its in-container path, e.g.:
#   /app/data/My Amusement Park Rides - Ride Ratings.csv
# If no path is given the script falls back to its built-in default
# (~/Downloads/... inside the container), which is NOT present in the image —
# so for production, always pass a path under /app/data.
#
# Usage:
#   ./scripts/run-import-ride-ratings.sh --user <name> --dry-run /app/data/rides.csv  # plan only
#   ./scripts/run-import-ride-ratings.sh --user <name> /app/data/rides.csv            # apply
#   ./scripts/run-import-ride-ratings.sh --user <name> --dry-run                      # plan (default path)
#   ./scripts/run-import-ride-ratings.sh --user <name>                                # apply (default path)
#
# A backup is recommended before the first real run (Settings page has a full
# backup export, or: docker compose exec db pg_dump -U wherewewere wherewewere > backup.sql)
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

DRY_RUN_ARGS=()
CSV_PATH=""
USER_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN_ARGS=("--dry-run") ;;
    --user) USER_NAME="${2:-}"; shift ;;
    --user=*) USER_NAME="${1#--user=}" ;;
    *) CSV_PATH="$1" ;;
  esac
  shift
done
if [[ -z "$USER_NAME" ]]; then
  echo "error: --user <username> is required (the account whose data the import changes)" >&2
  exit 1
fi

echo "==> Building server image (includes the compiled ride-ratings import script)"
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

RUN_ARGS=(--user "$USER_NAME")
if [[ ${#DRY_RUN_ARGS[@]} -gt 0 ]]; then
  RUN_ARGS+=("--dry-run")
fi
if [[ -n "$CSV_PATH" ]]; then
  RUN_ARGS+=("$CSV_PATH")
fi

echo "==> Running ride-ratings import${DRY_RUN_ARGS[*]:+ (dry run)}${CSV_PATH:+ using CSV: $CSV_PATH} for user $USER_NAME"
docker compose run --rm server node dist/plugins/location/scripts/import-ride-ratings.js "${RUN_ARGS[@]:+${RUN_ARGS[@]}}"

echo
if [[ ${#DRY_RUN_ARGS[@]} -gt 0 ]]; then
  echo "Dry run complete — nothing was written."
  echo "Review the list above, then re-run without --dry-run to apply."
else
  echo "Import applied. Re-running the script is idempotent (no-op on a second pass)."
fi
