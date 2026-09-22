# Writing a check-in type plugin

A plugin is a folder under `plugins/<name>/` with three files, joined by the
plugin `id`:

```
plugins/<name>/
  manifest.ts    # pure data: id, version, fields, strings (importable by both sides)
  server.ts      # exports `server: CheckinTypeServerPlugin`  (Node side)
  client.tsx     # exports `client: CheckinTypeClientPlugin`  (React side)
```

Register each side:

- Server: add an import + `{ ...manifest, server }` entry to
  [`server/src/plugins/registry.ts`](server/src/plugins/registry.ts).
- Client: add an import + `{ ...manifest, client }` entry to
  [`client/src/plugins/registry.ts`](client/src/plugins/registry.ts).

## Authoring checklist

### 1. Decide the storage mode

- **Generic (default — prefer this for new types).** The framework persists
  check-ins in the shared `plugin_checkins` JSONB table and provides, for free:
  - CRUD API at `/api/v1/plugins/<id>/checkins` (schema-validated).
  - Unified timeline branch (built from
    [`server/src/plugins/timeline.ts`](server/src/plugins/timeline.ts) +
    [`server/src/plugins/genericStore.ts`](server/src/plugins/genericStore.ts)).
  - Timeline filters: `filterParams` in the manifest become query params the
    framework scopes into the WHERE clause (string equality on `data` keys;
    numeric compare for `number`/`integer`/`rating`).
  - Backup export / restore / start-over / settings.
  - Auto UI: form, timeline card, detail page, profile tab, generated from
    `fields` alone.

  For generic storage you only need `manifest.ts` + an (almost empty)
  `server.ts` (`server: {}`). Reference:
  [`server/tests/fixtures/genericPlugin.ts`](server/tests/fixtures/genericPlugin.ts).

- **Custom (only when the type needs its own tables).** The plugin owns its
  schema (created by a numbered migration in `server/src/db/migrations/`) and
  must implement:
  - `storage: 'custom'`
  - `api` — Express router(s) mounted at `/api/v1<mount>` (own CRUD, webhooks,
    imports).
  - `buildTimelineSelect` + `buildTimelineWhere` — use
    `timelineColumnList()` / `timelineWhereConditions()` from
    `server/src/plugins/timeline.ts` / `server/src/plugins/sql.ts` so the
    branch emits the exact shared envelope (36 columns, ending in `timezone`).
    Hand-rolled column lists are how UNION branches silently desync.
  - `backupExport` / `backupImport` (+ `extraBackupTables` / `backupOrder` for
    secondary tables; inserts must be idempotent).
  - `deleteUserData` (start-over). Do **not** delete `plugin_settings` rows —
    the framework always does that itself (both on check-in delete and on
    settings reset).

### 2. Describe the data in `manifest.ts`

- `id`: `/^[a-z][a-z0-9_]*$/` — used in routes, `type` column, and
  `plugin_checkins.plugin_id`.
- `fields`: the single source of truth for the payload. Validation
  (`validatePluginData`), generic storage, and the auto UIs all derive from it.
- `strings`: display copy (title, singular/plural, form header, confirm delete).
- `filterParams` (optional): query-param names for Home timeline filters.

### 3. Optional cross-cutting hooks (all default to "opt out")

| Hook | When to add |
|---|---|
| `resolveTimestamps` | Photos/scrobble enrichment should anchor to this type. SQL: `(id, checked_in_at)` filtered on `$1` (`uuid[]`). |
| `latestTimezoneAsOf` | Integrations (e.g. the Plex webhook) should infer a timezone label from this type's most recent check-in. SQL: one `timezone` text column for `$1` (referenceTime), `$2` (user_id); single NULL row when none. |
| `reflectionBranch` | The "this day in previous years" panel. SQL filtered on `$1` user_id, `$2` date. |
| `earliestDate` | The all-time period selector needs the first entry date. SQL: single `date` text column for `$1`. |
| `llm` | Contribute rows + prompt lines to the LLM life summary. |
| `reconcile` | Rows can have a missing/wrong timezone label and participate in reconciliation. |
| `jobs` | Contribute background jobs (e.g. data backfills). The framework owns the jobs row lifecycle and dispatches `handler(jobId, { isCancelled, updateProgress })`; handlers must not write job status themselves. |
| `resetSettings` | Start-over "reset settings only" must clear user-scoped auxiliary tables. Returns rows deleted; run on the provided transaction client. |
| `settingsKeys` | Persist plugin settings in `plugin_settings` (framework upserts declared keys only). |
| `legacySettingsKeys` / `legacyBackupKeys` / `restoreLegacyBackup` | **Only when migrating an existing built-in type** (see note below). |

### 4. Client half

If you don't ship components, omit them — the framework renders
`AutoCheckInForm`, `AutoCheckInCard`, the generic detail page, and a counting
profile tab (`AutoProfileTab`: total count + most recent entry). Custom
components (`checkInForm`, `detailPage`, `timelineCard`, `filterSection`,
`profileTab`, `settings`, `reflectionCard`, `integrationsSettings`,
`dataSettings`) slot in one at a time. Note there is NO auto-generated
settings form: a plugin that declares `settingsKeys` but ships no `settings`
component simply gets no Settings tab (the settings component is rendered
self-contained, without injected props).

### 5. Test

Add an integration test that registers the plugin via
`registerPlugin()` (server registry) and exercises
CRUD → timeline → backup round-trip → start-over. Template:
[`server/tests/integration/generic-plugin.integration.test.ts`](server/tests/integration/generic-plugin.integration.test.ts).
Run with a test database: `npm run test:integration --workspace=server`.

## Shared helpers (don't reimplement)

- [`server/src/plugins/timeline.ts`](server/src/plugins/timeline.ts) — `TIMELINE_COLUMNS` / `timelineColumnList()`: the one authoritative envelope for every timeline UNION branch.
- [`server/src/plugins/sql.ts`](server/src/plugins/sql.ts) — `createSqlConditions()` / `timelineWhereConditions()`: user/date-range/search WHERE building with positional `$n` placeholders.
- [`server/src/plugins/uploads.ts`](server/src/plugins/uploads.ts) — `createImportUpload()` / `removeImportFile()`: multer disk-storage for import files.
- **Plugins must not query other plugins' tables directly.** Cross-plugin
  needs go through the shared contract hooks (e.g. timezone inference is a
  per-plugin `latestTimezoneAsOf` hook that integrations resolve by looping
  `allPlugins()` — see `plugins/sleep/server.ts` and
  `plugins/location/server.ts`), so a schema rename touches one file.
- `wwp-shared`: `isValidTimeZone()` (timezone validation), `validatePluginData()`, the full hook contract. Rebuild after edits: `npm run build --workspace=shared` (the server consumes the built CJS package; the client consumes TS source).
- [`server/src/constants.ts`](server/src/constants.ts) — `DEFAULT_USER_ID` (single-user app; do not re-hardcode the UUID).

## Note: retiring `restoreLegacyBackup`

`restoreLegacyBackup` + `legacyBackupKeys` + `legacySettingsKeys` exist only to
import backups that predate the `plugins` section. Mood and Sleep are the last
types that ship them. Once the earliest backups in circulation all carry a
`plugins.<id>` payload (i.e. after one full backup/restore cycle post-refactor),
delete:

1. `restoreLegacyBackup` / `legacyBackupKeys` / `legacySettingsKeys` from the
   shared contract (`shared/src/plugin.ts`) and from both plugins.
2. `restoreLegacyPluginData` + `claimedLegacyKeys` in
   [`server/src/plugins/backup.ts`](server/src/plugins/backup.ts) and the
   legacy-import skip logic in [`server/src/routes/backup.ts`](server/src/routes/backup.ts).

New plugins must never implement these hooks — use generic storage or a clean
custom-storage implementation instead.
