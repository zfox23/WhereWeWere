# Sleep check-in → plugin migration

Goal: the Sleep check-in type lives entirely in `plugins/sleep/`; no Sleep-specific code remains in the core platform (server, client, shared). Follows the established Mood migration pattern (custom storage).

## Current Sleep footprint in core

### Server
| Location | What |
|---|---|
| `server/src/routes/sleep-entries.ts` | CRUD router mounted at `/api/v1/sleep-entries` |
| `server/src/routes/webhook-sleep-as-android.ts` | Webhook at `/api/v1/webhook/sleep-as-android` (live sleep tracking, pending sessions, tz inference from last sleep entry, `sleep_webhook_events` log) |
| `server/src/routes/import-sleep-as-android.ts` | CSV import at `/api/v1/import/sleep-as-android` |
| `server/src/index.ts` | mounts the 3 routers |
| `server/src/routes/timeline.ts` | hard-coded `sleep` SELECT + WHERE branch, `sleep_duration` type-filter special case, `'sleep'` in `includedKeys` |
| `server/src/routes/stats.ts` | reflections `sleep` branch + `sleep_entries` response grouping; `/sleep-summary`, `/sleep-daily`, `/sleep-rating-distribution` endpoints; `sleep` key in `/earliest-dates` |
| `server/src/routes/backup.ts` | `sleepEntries` export query, legacy import loop, `BackupSleepEntry` type, start-over `delete_sleep_entries` block |
| `server/src/routes/llm.ts` | sleep query in `gatherLifeData` + "sleep entries" line pool |
| `server/src/services/timestampReconciliation.ts` | hard-coded sleep fallback-anchor query + `'a sleep entry'` label |

### Client
| Location | What |
|---|---|
| `pages/SleepCheckIn.tsx`, `pages/SleepDetail.tsx` | form + detail pages, routes in `App.tsx` (`/sleep-check-in`, `/sleep-entries/:id` + `EXPLICIT_PATHS`) |
| `components/SleepCard.tsx` | timeline card, rendered by hard-coded branch in `Home.tsx` |
| `components/SleepTab.tsx` | Profile tab, hard-coded tab in `Profile.tsx` |
| `components/filters/SleepFilter.tsx` (+ `Filters.tsx`) | Home filter section |
| `pages/Home.tsx` | `'sleep'` in `LEGACY_TYPE_IDS`, entire `includeSleep` state machine, `sleep_duration` param/pills/toggles, day-key special case, hard-coded FAB entry + day-dot link + `s` hotkey |
| `components/ReflectTab.tsx` | "Sleep in Pixels" year-in-pixels heatmap (via `stats.sleepDaily`) + "On This Day" `sleep_entries` rendering |
| `pages/settings/DataTab.tsx` | `SleepAsAndroidImportSection` |
| `pages/settings/IntegrationsTab.tsx` | Sleep-as-Android webhook URL + event count (`sleepWebhook.stats`) |
| `pages/settings/StartOverSection.tsx` | `delete_sleep_entries` checkbox |
| `api/client.ts`, `types/index.ts` | `sleepEntries`, `sleepWebhook`, `importApi.sleepAsAndroid`, sleep stats APIs, `SleepEntry`/`SleepSummaryStats`/`SleepDailyPoint`/`SleepRatingBucket` types, `TimelineItem` sleep columns |
| `plugins/registry.ts` (client) | stale `case 'sleep'` in `timelineDetailPath` |

### Tables (stay in DB, owned by plugin migrations)
`sleep_entries`, `sleep_webhook_events` (migrations 022/023) — no new migration needed; plugin uses them directly, exactly as Mood did.

## New plugin structure

```
plugins/sleep/
  manifest.ts        id 'sleep', fields: started_at, ended_at, rating (1-5), comment
                     filterParams: ['sleep_duration'], strings (title 'Sleep', tab 'Sleep', ...)
  server.ts          storage: 'custom'
    api mounts:      /sleep-entries (CRUD), /webhook/sleep-as-android, /import/sleep-as-android
                     (+ /sleep-entries/stats/* : summary, daily, rating-distribution, earliest)
    buildTimelineSelect / buildTimelineWhere  (moves from timeline.ts; duration buckets)
    backupExport / backupImport / restoreLegacyBackup (claims legacyBackupKeys ['sleepEntries'])
    deleteUserData / resolveTimestamps / reflectionBranch / earliestDate / llm / reconcile
  client.tsx         icon Moon, hotkey 's', checkInPath '/sleep-check-in', detailPath '/sleep-entries/:id'
    checkInForm / detailPage / timelineCard / filterSection / profileTab / reflectionCard /
    dataSettings (Sleep-as-Android CSV import) / integrationsSettings (webhook URL + stats)
  ui/                SleepCheckIn, SleepDetail, SleepCard, SleepTab (stats), SleepFilter,
                     SleepYearInPixels, SleepAsAndroidImportSection, api.ts, types.ts
```

Registration: `server/src/plugins/registry.ts` + `client/src/plugins/registry.ts`.

Everything else is pure removal from core (see todo list). Client `Home`/`App`/`Profile`/`Settings` generic plugin mechanisms (already built for Mood) pick Sleep up automatically: FAB, hotkeys, day-dots, routes, profile tab, data-settings section.

## Core-platform adjustments required (need approval)

**A. Framework: multiple API mounts per plugin.**
`CheckinTypeServerPlugin.api` currently supports one mount. Sleep needs three stable URLs
(`/api/v1/sleep-entries`, `/api/v1/webhook/sleep-as-android`, `/api/v1/import/sleep-as-android`).
The webhook URL is user-configured in the Sleep as Android app, so changing it breaks live setups.
Change: make `api` accept an array of `{ mount, router }` (or add `apiMounts`). Tiny framework edit in `shared/src/plugin.ts` + `server/src/index.ts` mount loop; Mood keeps working (single-entry array).
*Alternative (feature removal):* collapse to one mount → webhook URL changes (breaks user configs). Not recommended.

**B. ReflectTab "On This Day" — generic plugin rendering.**
Today `/stats/reflections` groups `type='sleep'` rows into a dedicated `sleep_entries` array and
`ReflectTab` renders them with hard-coded sleep code. After migration, sleep rows arrive through
the plugin `reflectionBranch` like mood rows. Core adjustments:
- `stats.ts`: drop the sleep-branch special grouping; plugin rows land in `items` (with `data` jsonb).
- `ReflectTab.tsx`: render non-location `items` via the registered plugin's `reflectionCard`
  (the contract already exists but is unused); Sleep ships a `reflectionCard` ported from the
  current "Slept for X" link. This also removes the hard-coded mood path/label special-casing.
*Alternative (feature removal):* remove "Slept for …" rows from the On This Day list entirely.

**C. Start Over — per-plugin options.**
Server today: `delete_mood_checkins` → deletes **all** plugin check-ins; client labels the box
"All Mood Checkins". Once Sleep is a plugin, that box would silently delete sleep data too (bug).
Adjustment: generate one checkbox per registered plugin in `StartOverSection` (client), and have
`/backup/start-over` accept per-plugin options mapped to the existing
`deletePluginData(client, USER_ID, [pluginIds])` (server). Same for settings reset
(`reset_mood_settings` currently resets all plugins' settings).
*Alternative (feature removal):* keep only "All Checkins"; drop the per-type checkboxes.

## Non-questions (following the Mood precedent, no framework change)
- "Sleep in Pixels" heatmap in `ReflectTab`: core imports the sleep plugin's `SleepYearInPixels`
  component + stats API directly — same pattern as `MoodYearInPixels`/`moodStats.heatmap`.
- LLM summary, timestamp reconciliation, earliest-dates, photo/scrobble anchors: existing plugin
  hooks (`llm`, `reconcile`, `earliestDate`, `resolveTimestamps`) take over; core only removes its
  hard-coded sleep code. (Sleep has no photo/scrobble attachment today; `resolveTimestamps` is
  included for parity with Mood.)
- `sleep_entries`/`sleep_webhook_events` tables and migrations stay as-is (plugin-owned, like mood tables).
- FAB visual order: Sleep moves from the hard-coded slot into the generic plugin list (position
  via `fabOrder`). Minor visual shift only.

## Test impact
- `server/tests/services/timestampReconciliation.test.ts`: query sequence changes (sleep moves from the 4th hard-coded query to a registry hook mock).
- `server/tests/integration/api.integration.test.ts`: still inserts `sleep_entries` rows directly (fine — table unchanged) but fallback-anchor assertion comes from the plugin hook.
- `server/tests/integration/backup-media-roundtrip.test.ts` / backup tests: `sleepEntries` key behavior changes (claimed by plugin payload).
- New: sleep plugin server tests (CRUD, webhook, import, timeline, backup round-trip) mirroring mood coverage where practical.
- Client: existing Home/Profile behavior now exercised via plugin paths.
