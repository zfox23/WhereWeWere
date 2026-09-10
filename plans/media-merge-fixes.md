# WhereWeWere — `media` → `main` Pre-Merge Fix Plan

**Branch:** `media` (`b7a237f2`) → `main` (`93420865`)
**Status of this plan:** implementation-ready for a code agent. Phase 1 is merge-blocking; Phase 2 is recommended-but-optional; Phase 3 is post-merge.

---

## 0. Verified Git State (read-only inspection of `.git` refs and reflogs)

Verified by reading `.git/HEAD`, `.git/refs/**`, and `.git/logs/refs/heads/*` (this environment had no shell; the listed commands let you re-verify):

| Fact | Value |
|---|---|
| Current branch (HEAD) | `media` |
| `main` (local) | `93420865dfa9d762f6ad2eab8d65297008881da3` |
| `origin/main` | `93420865...` (in sync) |
| `media` (local) | `b7a237f2d34ccb875db2f8285f3863287da7d4ff` |
| `origin/media` | `b7a237f2...` (in sync) |
| Divergence | **`media` is 6 commits ahead of `main`, 0 behind.** `media`'s reflog line 1: "Created from HEAD" at exactly `93420865` (current `main` tip); `main`'s reflog ends at that same commit. |

The 6 media commits: `de0db0f5` (huge media checkins feature), `7516dbf7` (further progress), `2e4cecd7` (more progress), `203a9920` (timestamp reconciliation + time played), `35aca2d8` (additional book details), `b7a237f2` (media library).

**Consequences:**
- **The merge is a fast-forward. Merge conflict risk is ZERO** — the statically inferred HIGH risk for `timeline.ts`/`backup.ts`/`App.tsx`/`client.ts`/`Home.tsx`/`settings.ts` is moot because `main` has not touched any file since the branch point. All the flagged changes exist only on the `media` side.
- If other work lands on `main` before the merge, re-run `git log media..main --oneline` and re-evaluate; `server/src/routes/timeline.ts` and `server/src/routes/backup.ts` would then be the highest-conflict files.
- **Caveat:** working-tree cleanliness (`git status --porcelain`) could not be determined statically. **First action for the executor: run `git status` and commit/stash nothing — if dirty, confirm with the user before proceeding.**

## 1. Spot-Check Results (F1–F5 verified against current code)

- **F1 — CONFIRMED.** `backup.ts:431-438` export SELECT lists only `id, media_type, external_source, external_id, title, author, release_year, image_url, external_url, created_at, updated_at` — missing `platform` (migration `035`) and `page_count/series_name/series_position/series_count` (migration `037`). Check-in export at `backup.ts:440-448` missing `time_played_minutes` (migration `036`). Import INSERTs mirror the gaps: items at `backup.ts:1004-1014`, check-ins at `backup.ts:1046-1062`. Backup → restore permanently drops game platform, book page/series metadata, and all game time played. No round-trip test exists (searched `server/tests`; only `media.integration.test.ts:501` start-over test).
- **F2 — CONFIRMED.** `media.ts:425-444` (POST check-ins) stores `time_played_minutes` as submitted (only validates non-negative finite integer). The detail read at `media.ts:355-362` treats "latest non-null `time_played_minutes` by `checked_in_at`" as the running total, so a lower manual entry (especially backdated) permanently lowers the displayed total. The yamtrack importer enforces the max rule via `applyMaxTimePlayed` (`import-yamtrack.ts:161-185`) — manual create does not. Form copy confirms product intent: "The running total for this game — new check-ins update the total, they don't add to it." (`MediaCheckInForm.tsx:237-239`).
- **F3 — CONFIRMED.** `media.ts:529-532` fetches `cachedRows = SELECT DISTINCT season_number` (season numbers only). The stale+TMDB-unavailable fallback at `media.ts:561` maps those to `{season_number, episode_number: 0, episode_title: null}`, and `buildSeasonList` (`media.ts:588-603`) silently drops every row with `episode_number <= 0` (line 593). Result: every season renders with zero episodes. Fix is trivial: the fallback should query the actual cached episode rows (exactly what the fresh-cache branch at `media.ts:542-546` does) and pass them to `buildSeasonList`.
- **F4 — CONFIRMED.** `client.ts:30-32` `request()` reads `error.message` only; the server responds `{ error: "..." }` (verified at `media.ts:305, 338, 382, ...` and `checkins.ts`). Inconsistent sibling call sites in the same file already do it right: `client.ts:271, 323, 353, 360, 400` use `error.error || error.message`. Every failed media call currently surfaces as "Request failed: 500".
- **F5 — CONFIRMED.** `MediaCheckInForm.tsx:214-217` hours input has `max="23"`, capping manual totals at 1439 min (~23h59m). Server accepts any non-negative integer (`media.ts:440-442`); only the form blocks it. Also verified for context: F6 (`tmdb.ts:98,114` hardcode `page=1`) and F14 (`tmdb.ts:139-141` filters `season_number 0`) are accurate.

**No findings from the review were wrong or already fixed.**

## 2. Scope & Assumptions

**In scope (merge-blocking):** data-loss and correctness bugs (F1, F2, F3) plus the two one-line-adjacent UX/correctness fixes (F4, F5) and the tests that prove them.

**Explicitly deferred (Phase 3) with rationale:** F6 (search pagination — feature, not bug), F7 (item edit/delete — new API surface + product decision on delete semantics), F8 (check-in edit UI — no UI consumer today), F12/F13 (search-quality / read-side-write refactor). Rationale: none cause data loss or wrong data on the happy path; they are larger or require product decisions that shouldn't block this merge.

**Assumptions:**
- Postgres 16 (postgis image in `docker-compose.yml`); test DB for integration tests is `wherewewere_test` at `postgres://wherewewere:wherewewere@localhost:5432/wherewewere_test` (per `server/package.json` `test:integration` default).
- Existing backups created before this fix will simply lack the new keys on import — the import path already null-tolerates missing fields (`toStringOrNull` etc.), so no backward-compat break. No migration needed; all five columns already exist via migrations 035–037.
- The executor works on the `media` branch (currently checked out) and must not touch `main`.

---

## Phase 1 — Must-Fix Before Merge

### P1.1 — F1: Backup export/import drops media columns (HIGH, data loss)

**Root cause:** Export SELECTs and import INSERTs in `server/src/routes/backup.ts` were written against the pre-035/036/037 schema and never updated.

**Changes (all in `server/src/routes/backup.ts`):**
1. **Export, media items** (~line 431): add `platform, page_count, series_name, series_position, series_count` to the SELECT column list.
2. **Export, media check-ins** (~line 440): add `time_played_minutes` to the SELECT column list.
3. **Import, media items INSERT** (~line 1004): add the five columns. Value mapping: `toStringOrNull(item.platform)`, `toStringOrNull(item.series_name)`, and for the three integers `page_count`/`series_position`/`series_count`: `item.X != null && Number.isFinite(Number(item.X)) ? Math.round(Number(item.X)) : null` (match the existing `toNumber`/`toStringOrNull` helper style used in this file; prefer an existing helper if one fits).
4. **Import, media check-ins INSERT** (~line 1046): add `time_played_minutes` with the same integer coercion, honoring the column's `CHECK (time_played_minutes IS NULL OR time_played_minutes >= 0)` constraint (null out negatives instead of failing the row).

**Test plan — new integration test** (new file `server/tests/integration/backup-media-roundtrip.test.ts`, modeled on `media.integration.test.ts` setup):
1. Seed via API: a game item with `platform`, a book item with `page_count`/`series_name`/`series_position`/`series_count`, and check-ins with distinct `time_played_minutes` values.
2. `GET /api/v1/backup/export` → assert the JSON contains all five item columns and `time_played_minutes` for every check-in.
3. `POST /api/v1/backup/start-over` (wipe), then `POST /api/v1/backup/import` with the export payload.
4. Re-fetch items + check-ins via `GET /api/v1/media/items/:id` and `GET /api/v1/media/items/:id/checkins`; assert `platform`, the four book fields, and each `time_played_minutes` survive byte-for-byte, and `total_time_played_minutes` matches the pre-export value.
5. Also assert a legacy-shaped payload (keys absent) imports without error (nulls) — guards backward compatibility.

**Risk/rollback:** additive columns in JSON; old backup files still import (keys absent → null). If the fix regresses, revert the single commit; no schema change.

### P1.2 — F2: Manual check-in can decrease game total time (HIGH)

**Root cause:** `POST /media/items/:id/checkins` (`server/src/routes/media.ts:401-450`) stores `time_played_minutes` as submitted, while the read path (`media.ts:355-362`) treats the latest non-null value as the running total, and the yamtrack importer already enforces "never decrease" (`applyMaxTimePlayed`, `import-yamtrack.ts:161`).

**Decision (recommended):** **server-side clamp, `stored = GREATEST(existingLatestTotal, submitted)`** — identical semantics to the importer, no new error surface, matches the form's "running total" copy. (Alternative: reject lower values with a 400 and a client toast — more visible but inconsistent with the importer and adds a failure path for a benign case.)

**Changes:**
1. `server/src/routes/media.ts` — in the POST check-ins handler, when `time_played_minutes` is a valid non-negative integer: first query the current total,
   `SELECT time_played_minutes FROM media_checkins WHERE media_item_id = $1 AND time_played_minutes IS NOT NULL ORDER BY checked_in_at DESC, id DESC LIMIT 1`
   (same ordering as the read path and `currentTotalPlayed` in `import-yamtrack.ts:144-148`), then store `Math.max(existing ?? 0, submitted)`.
2. `client/src/pages/media/MediaCheckInForm.tsx` — lightweight client guard: when the entered total (hours*60 + minutes) is below the prefilled current total, show an inline note "Total time played can't decrease below the current total (Xh Ym) — the latest value will be kept." Non-blocking; the server clamp is the source of truth. (Do not add a `min` attribute to the two-input hours/minutes pair — the note is simpler and covers backdated entries.)

**Test plan — extend `server/tests/integration/media.integration.test.ts`:**
- Create game item → check-in with `time_played_minutes: 120` → `GET /items/:id` shows `total_time_played_minutes: 120`.
- New check-in with `time_played_minutes: 60` (later `checked_in_at`) → total still **120** (regression test for this bug).
- New check-in with `time_played_minutes: 300` → total **300**.
- Check-in with `time_played_minutes` omitted → total unchanged (120→300 in sequence).

**Risk/rollback:** clamp only ever raises the stored value toward what the importer would have done; worst case a user intended to correct an error — they can fix it in Phase 3 when check-in editing exists. Revert = single commit.

### P1.3 — F3: Stale episode cache + TMDB down ⇒ all seasons show zero episodes (MEDIUM)

**Root cause:** `media.ts:561` builds the fallback from `cachedRows`, which is `SELECT DISTINCT season_number` (season numbers only, `media.ts:529-532`), mapping them to zeroed episode placeholders; `buildSeasonList` (`media.ts:588-603`, guard at line 593) drops every `episode_number <= 0` row.

**Changes — `server/src/routes/media.ts` stale-fallback branch (~line 560-562):** replace the zeroed-placeholder mapping with the exact query the fresh-cache branch already uses:
```sql
SELECT season_number, episode_number, episode_title
FROM media_tv_episodes WHERE media_item_id = $1
ORDER BY season_number, episode_number
```
and pass those rows to `buildSeasonList`. (Net effect: the stale+TMDB-down branch becomes identical to the fresh-cache branch — which is correct: serve the cache.)

**Test plan:**
- New integration tests in `server/tests/integration/media.integration.test.ts` (or a new `tv-seasons.integration.test.ts`) for `GET /media/tv/:itemId/seasons` — currently **zero test coverage**, the riskiest server code in the diff:
  1. **Cache fresh** (insert `media_tv_episodes` rows with recent `cached_at`) → returns real episodes, `cached: true`.
  2. **Stale + TMDB unavailable** (old `cached_at`, no/invalid `tmdb_api_key` in settings so `getShowSeasons` returns null) → **returns the actual cached episodes** (this is the F3 regression), `cached: true`.
  3. **No cache, no key** → `{ seasons: [], cached: false }`.
- Unit test for `buildSeasonList` if it is exported; otherwise cover its filtering behavior through test 2 above.

**Risk/rollback:** strictly narrows behavior to "serve what we have"; revert = single commit.

### P1.4 — F4: Client `request()` swallows server error messages (MEDIUM)

**Root cause:** `client/src/api/client.ts:30-32` reads `error.message`, but server error bodies use `{ error: "..." }`.

**Change (one line):** `client.ts:32` →
```ts
throw new Error(error.error || error.message || `Request failed: ${res.status}`);
```
(matches the pattern already used at `client.ts:271, 323, 353, 360, 400`).

**Test plan:** add a client unit test (new `client/tests/api/client.test.ts` or extend an existing one) mocking `fetch` to resolve `{ ok: false, status: 500, json: async () => ({ error: 'Failed to search media' }) }` and asserting the thrown message is `Failed to search media`.

**Risk/rollback:** none — pure improvement; existing catch-fallback still covers non-JSON bodies.

### P1.5 — F5: Hours input capped at 23 (MEDIUM)

**Root cause:** `MediaCheckInForm.tsx:217` sets `max="23"` on a *cumulative total* field, not a clock.

**Change:** remove `max="23"` from the hours input (keep `min="0"`; minutes keeps `max="59"`). Optionally cap hours at a sane ceiling like `max="10000"` to avoid absurd values — recommended, harmless.

**Test plan:** optional component assertion that the hours input has no `max` of 23; primarily verified by the Phase 1 manual smoke test below.

**Risk/rollback:** none.

### Phase 1 verification (run on `media` before merging)
```bash
git status                                   # must be clean (or user-confirmed)
npm test                                     # root: client + server unit tests
npm run test:integration                     # server integration (needs Postgres test DB, see checklist)
npm run build                                # client (tsc -b + vite) + server (tsc) typecheck/build
```

---

## Phase 2 — Should-Fix, Cheap Wins (fold into the same PR; skip individually if pressed)

### P2.1 — F9: Dead/leftover code
- Delete `checkinFormPath` from `client/src/utils/media.ts:84` (exported, referenced nowhere — grep-verify before deleting).
- Yamtrack preview/import shape mismatch: remove `time_played_minutes` / `media_item_id` / `imported_checkin_id` from the **preview** client type (`client/src/types/index.ts` `YamtrackPlanRow`-used-by-preview) so the preview type matches what `POST /preview` actually returns (`import-yamtrack.ts:242-259`); keep them on the import-result type. (Alternative if those fields ARE expected later: add them to the preview response — but they don't exist pre-import, so removing from the preview type is correct.)
- `created_media_items` counter (`import-yamtrack.ts:68`): increment it **only** when a genuinely new `media_items` row is inserted (i.e. move the increment inside the insert branch of `upsertMediaItemWithClient`'s result path). Keep the field (it's part of the API response) even though it's not rendered yet.

### P2.2 — F10: Timeline slug inconsistency
Drop `media_slug` from the `GET /timeline` response (`server/src/routes/timeline.ts:372`) and let the client keep using `slugify()` (`client/src/utils/slugify.ts`). The route ignores the slug param, so removing the field is safe — verify no client code reads `media_slug` (grep; `MediaCard.tsx:22` uses `slugify` per the review). One source of truth (client) instead of two divergent implementations.

### P2.3 — F11: Episode refresh not transactional + double TMDB fetch
- `refreshEpisodesFromTmdb` (`media.ts:609-632`): wrap the per-episode upserts in `BEGIN`/`COMMIT` (and `ROLLBACK` on error) on the passed-in pool client, so a mid-refresh crash doesn't leave partial season data.
- Avoid the double `tmdb.getShowSeasons` call in the stale path (`media.ts:551` then `:616`): give `refreshEpisodesFromTmdb` an optional pre-fetched `seasons` parameter and pass the already-fetched `fresh` result from `media.ts:554`.

### P2.4 — F14: Season 0 (specials) silently dropped
- `server/src/services/tmdb.ts:139-141`: stop filtering `season_number 0` in `getShowSeasons`. **Check the cache:** the result is cached under `tmdb:seasons:${tmdbId}` — if that cache persists (inspect the `cache` implementation's TTL), bump the cache key (e.g. `tmdb:seasons:v2:...`) so stale filtered results don't linger.
- `client/src/pages/media/TvEpisodePicker.tsx:111-113`: label `season_number === 0` as "Specials" instead of "Season 0".
- Improves the empty-state case (show with only specials) from "No season/episode data available" to an actually-usable picker.

### P2.5 — F8 (partial): Lock down `PUT /media/checkins/:id` semantics with a test
The COALESCE-based update (`media.ts:453-493`) can never null out `raw_score`/`notes`/`time_played_minutes`. Add integration tests asserting: (a) partial update changes only provided fields; (b) omitting a field leaves it unchanged; (c) document (comment) that null-out is intentionally unsupported. UI wiring stays Phase 3.

### P2.6 — Fill two cheap untested gaps
- Unit tests for `toIntOrNull` (string / NaN / negative / float inputs) used by `POST /media/items` (`media.ts:326-329`).
- Integration test for the yamtrack "imported < existing ⇒ keep existing" branch of `applyMaxTimePlayed` (`import-yamtrack.ts:161`).

---

## Phase 3 — Post-Merge Follow-Ups (one PR each, scheduled after main is stable)

- **F7 — Item edit/delete.** No way to fix a typo'd custom title, a wrong API pick, or a pre-dedupe duplicate; deleting all check-ins leaves an orphan polluting search forever. *Direction:* `PUT /media/items/:id` (title/author/year/image/metadata) + `DELETE /media/items/:id` with **refuse-when-check-ins-exist (409)** as default and an explicit `?cascade=true` that deletes check-ins and list memberships; small edit/delete UI on `MediaDetail.tsx`. Recommend also a one-off "clean orphans" job for items with zero check-ins. *Deferral rationale:* new API surface + a product decision on delete semantics; not merge-blocking.
- **F6 — Search pagination / "more results".** All three providers return page 1 only (`tmdb.ts:98,114`; `hardcover.ts:65`; `tgdb.ts:112`), so obscure titles force "Add Custom" (null `external_id`, can never merge with the API entity). *Direction:* thread a `page` param through `searchMedia` and the three services (TMDB/TGDB paginate natively; Hardcover has no pagination — cap it and say so), plus a "not found here? Add custom (it won't sync with the API)" hint. *Deferral rationale:* multi-service + UI work with no data-loss impact.
- **F8 (rest) — Check-in edit UI.** Wire the existing `PUT /media/checkins/:id` into `MediaDetail.tsx` (inline edit of notes/rating/time), which also gives users the escape hatch for the F2 clamp. *Deferral rationale:* UI feature; route already exists and will be tested in P2.5.
- **F12 — Search quality.** Local match is `ILIKE '%q%' OR to_tsvector(...) @@ plainto_tsquery(...)` (`media.ts:182`) and external dedup keys on `external_url` over only the first 50 local rows (`media.ts:188`). *Direction:* evaluate `websearch_to_tsquery`; dedup on `(external_source, external_id)` where present, falling back to URL; decide if search needs pagination at all.
- **F13 — Read-side writes in search.** `GET /media/search` runs `backfillBookMetadata` UPDATEs (`media.ts:258`). *Direction:* move backfill into the item upsert path (and/or a background job), keep search read-only; add a test for the backfill path (currently untested).
- **Client test backlog.** Component tests for `MediaSearch` (silent failure at `MediaSearch.tsx:68` — add a toast), `MediaDetail`, `TvEpisodePicker`, `MediaCheckInForm`, `MediaCard`, and `formatTimePlayed` in `utils/media.ts`. Plus end-to-end test for the yamtrack game-playtime DB merge (`yamtrack.ts:338`).

---

## Merge Strategy

**Verified state makes this a fast-forward merge** — `main` has not moved since `media` was created from it. No conflict resolution is expected.

**Order of operations (executor on `media`, currently checked out):**
1. `git status` — confirm clean tree (stop and ask the user if dirty).
2. Implement Phase 1 items as **separate commits** (one per finding: `fix: backup export/import media columns`, `fix: never decrease game total time played`, `fix: serve cached episodes when TMDB unavailable`, `fix: surface server error messages in client`, `fix: remove 23h cap on game time input`). Tests ride in the same commits.
3. (If approved) Phase 2 items, one commit each.
4. Run the full pre-merge verification checklist (below) locally.
5. Push `media`; open/refresh PR `media → main`; let CI pass.
6. **Merge style — recommendation: squash.** `main` is exactly at the branch point and the 6 incoming commits are large WIP-style commits ("huge media checkins feature", "More progress"), so on `main`: `git merge --squash media` + a single commit like `Add media checkins (movies, TV, books, games) with TMDB/Hardcover/TGDB, yamtrack import, and media library`. Clean, reviewable main history; the granular fix history stays preserved on `origin/media` and in the PR. *Alternative:* `git merge --no-ff media` if the user prefers to keep the 6+fix commits verbatim.
7. After main is merged & healthy: push `main`; optionally delete `media` locally (keep `origin/media` until the Phase 3 items referencing it are done).

**Pre-merge verification checklist:**
- [ ] `git status` clean on `media`.
- [ ] Postgres available for integration tests: `docker compose up -d db` (or existing instance), then ensure the test DB exists: `psql postgres://wherewewere:wherewewere@localhost:5432/wherewewere -c 'CREATE DATABASE wherewewere_test;'` (see `docs/testing-strategy.md` if it documents another setup).
- [ ] `npm test` (root) — client + server unit tests green.
- [ ] `npm run test:integration` (server; uses `DATABASE_URL=postgres://wherewewere:wherewewere@localhost:5432/wherewewere_test` by default) — green, including the new F1 round-trip, F2 max-total, and F3 seasons tests.
- [ ] `npm run build` — client `tsc -b && vite build` and server `tsc` pass (catches type errors from the `request()` change and type removals in P2.1).
- [ ] Manual smoke (optional but cheap): start stack, check in a game with total > 23h (F5), verify a lower total doesn't decrease the displayed total (F2), search + check-in a TV show with episodes cached (F3), confirm a real API error surfaces its message (F4), export → start-over → import → verify platform/book fields and time played survive (F1).
- [ ] CI green on the PR.

---

## Decisions Needed From the User (recommendations included)

| # | Decision | **Recommendation** | Alternative |
|---|---|---|---|
| D1 | **F2 semantics:** how to handle a manual time-played value lower than the current total? | **Server-side clamp** to `GREATEST(existing, submitted)` — consistent with the yamtrack importer, no new error path, matches the "running total" UI copy. Client shows a non-blocking warning. | Reject with a 400 + client toast. More visible, but inconsistent with the importer and adds a failure mode for a benign correction (user can delete the check-in instead). |
| D2 | **Merge style** | **Squash** the 6 WIP-style commits + fixes into one descriptive commit on `main`. | `--no-ff` merge preserving all commits (main history stays noisier). |
| D3 | **Scope of this PR:** include Phase 2? | **Yes** — all six items are small, low-risk, and touch files the Phase 1 work already does; splitting them out costs a second PR and a second merge window. | Phase 1 only; Phase 2 becomes a fast follow-up PR. |
| D4 | **F8 (Phase 3):** when item/check-in editing is built, wire up check-in editing or delete the dead `PUT /media/checkins/:id` route + `media.updateCheckin()`? | **Keep the route** (P2.5 tests it) and wire the edit UI later — deletion adds churn and the route is the escape hatch for F2-clamped values. | Delete route + client method now to avoid dead surface. |
| D5 | **F7 (Phase 3) delete semantics** — decide now so the Phase 3 PR is unblocked: refuse delete when check-ins exist (409) with explicit cascade flag? | **Yes** — refuse by default, `?cascade=true` to also delete check-ins + list memberships; plus an orphan-cleanup job for zero-check-in items. | Always cascade (simpler, riskier). |
