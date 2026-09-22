---
name: create-checkin-plugin
description: Creates a new WhereWeWere check-in type plugin (plugins/<name>/ with manifest.ts, server.ts, client.tsx) that adds a full time-series check-in feature: manual check-in entry, data import from an external platform, Home timeline filters, a Profile stats tab, Reflect "On This Day" entries, a check-in detail page, Settings sections, and data export/restore. Use when asked to add a new checkin type, plugin, or data category (e.g. workouts, reading, finances) to WhereWeWere.
---

# Creating a new check-in type plugin

A plugin is a folder `plugins/<name>/` with three files joined by the plugin `id`:

```
plugins/<name>/
  manifest.ts    # pure data: id, version, fields, strings (no React, no Node)
  server.ts      # exports `server: CheckinTypeServerPlugin`
  client.tsx     # exports `client: CheckinTypeClientPlugin`
```

The framework provides defaults for everything you omit: `AutoCheckInForm` and
`AutoCheckInCard` UIs generated from `fields`, a generic detail page, a counting
Profile tab, a type-include timeline toggle, and (for generic storage) the full
CRUD API, unified timeline branch, and backup export/restore/start-over.
**Generic storage is the default — prefer it unless the type needs its own
tables** (e.g. related entity tables, lookups, or a large normalized dataset).

Canonical architecture reference: [`plans/plugin-authoring.md`](../../../plans/plugin-authoring.md:1).
Read it before starting; it documents every hook in depth.

## When to use

- The user wants a new check-in data type in WhereWeWere (a new plugin folder
  under `plugins/`), whether from scratch or by importing an existing
  time-series dataset from another platform.

## When NOT to use

- Modifying an **existing** plugin — just edit its files; this skill's
  registration steps are already done.
- Adding a setting to an existing plugin's `settingsKeys` — a one-line change.
- Adding a non-check-in feature (integrations, jobs, routes that don't create a
  new check-in type) — hand off to the appropriate mode and consult
  `server/src/plugins/registry.ts` directly.

## Inputs required

Before writing code, confirm (ask only what's missing):

1. **Plugin name/id** — lowercase, `/^[a-z][a-z0-9_]*$/`, e.g. `workouts`.
2. **Dataset shape** — for each stored element: field name, kind
   (`text | textarea | number | integer | boolean | date | datetime | rating |
   select | multi-select`), label, required?, options/min/max, unit, and which
   field (if any) is authoritative for the timestamp (`isTimestamp: true`).
3. **Example dataset** (for import) — a sample of the external data and its
   source format (CSV/JSON/export file).
4. **Which features are needed** — by default deliver ALL of: manual check-in,
   import, timeline filters, Profile tab stats, Reflect entries, detail page,
   Settings, export/import. Confirm only the ones that genuinely don't apply.

## Workflow

### 1. Write `plugins/<name>/manifest.ts`

The manifest is the single source of truth: validation, generic storage, and
the auto UIs all derive from `fields`. Model it on
[`plugins/mood/manifest.ts`](../../../plugins/mood/manifest.ts:13) (shape) or
[`server/tests/fixtures/genericPlugin.ts`](../../../server/tests/fixtures/genericPlugin.ts:14)
(minimal generic plugin).

- `id`: must match the folder name and pass `/^[a-z][a-z0-9_]*$/` — the
  registry throws on violation.
- `fields`: one entry per stored datum. `select`/`multi-select` need
  `options: [{ value, label, icon? }]`; numeric fields can carry `unit`
  (rendered in the auto card). Set `isTimestamp: true` on the field that
  defines "when" for dataset rows without their own timestamp.
- `strings`: `title`, `singular`, `plural`, `newCheckIn`, `profileTab`,
  `confirmDelete` — display copy used in the FAB, filters, tab bar, and delete
  dialog.
- `filterParams`: URL query-param names for Home timeline filters
  (e.g. `['flavor', 'score']`). String fields filter by equality on the
  `data` key; `number`/`integer`/`rating` fields support numeric compare.

### 2. Write `plugins/<name>/server.ts`

**Generic storage (default):** an almost-empty server half:

```ts
import type { CheckinTypeServerPlugin } from 'wwp-shared';

export const server: CheckinTypeServerPlugin = {
  // no storage key => 'generic'; framework provides CRUD, timeline, backup,
  // restore, and start-over.
  settingsKeys: [ /* optional, see step 6 */ ],
};
```

**Custom storage (only when the type needs its own tables):** add a numbered
migration in `server/src/db/migrations/`, then implement `storage: 'custom'`,
`api` (Express router(s) mounted at `/api/v1<mount>`),
`buildTimelineSelect` + `buildTimelineWhere` (build with
`timelineColumnList()` / `timelineWhereConditions()` from
[`server/src/plugins/timeline.ts`](../../../server/src/plugins/timeline.ts:1)
and [`server/src/plugins/sql.ts`](../../../server/src/plugins/sql.ts:1) so the
UNION branch keeps the shared 36-column envelope — hand-rolled column lists are
how branches silently desync), `backupExport` / `backupImport` (inserts must be
idempotent), and `deleteUserData`. Study
[`plugins/media/server.ts`](../../../plugins/media/server.ts:1) as a custom
reference before writing your own.

**Optional server hooks** (add only when relevant — full semantics in
[`plans/plugin-authoring.md`](../../../plans/plugin-authoring.md:67)):

| Hook | Add when |
|---|---|
| `reflectionBranch` | Reflect "On This Day" entries are required for this type (SQL: `$1` user_id, `$2` date). |
| `settingsKeys` | The type has user settings (see step 6). |
| `api` | The import flow needs a server endpoint (see step 4). |
| `resolveTimestamps` | Photos/scrobble enrichment should anchor to this type. |
| `latestTimezoneAsOf` | A webhook/integration should infer a timezone from this type. |
| `earliestDate` | The all-time period selector should include this type. |
| `llm` | This type should contribute to the LLM life summary. |
| `reconcile` | Rows can carry a missing/wrong timezone label. |
| `jobs` | The import/backfill should run as a cancellable background job. |
| `resetSettings` | The type owns user-scoped auxiliary tables beyond check-ins. |

### 3. Register the server half

Add to [`server/src/plugins/registry.ts`](../../../server/src/plugins/registry.ts:31):

```ts
import { server as workoutsServer } from '../../../plugins/workouts/server';
import { manifest as workoutsManifest } from '../../../plugins/workouts/manifest';
// ...
{ ...workoutsManifest, server: workoutsServer },
```

The registry enforces id format and uniqueness at startup — a bad `id` fails
the server build.

### 4. Deliver data import from the external platform

Goal: the user can upload their example dataset once and every row becomes a
check-in.

1. **Format adapter**: put a pure parse function in
   `plugins/<name>/utils/` (e.g. `parseImport.ts`) that maps one external row
   to `{ checked_in_at, checkin_timezone?, data }` shaped for
   `POST /api/v1/plugins/<id>/checkins`. Validate with `validatePluginData`
   from `wwp-shared` and skip-with-report invalid rows.
2. **Delivery mechanism** — plugin-owned API routes (declare each mount in
   `server.api`; they mount at `/api/v1<mount>`). Three proven precedents:
   - **Multipart file upload** (preferred for binary/large exports):
     `createImportUpload()` from
     [`server/src/plugins/uploads.ts`](../../../server/src/plugins/uploads.ts:29)
     (multer disk storage + `removeImportFile()` for cleanup). Precedents:
     [`plugins/mood/server.ts`](../../../plugins/mood/server.ts:777) (Daylio
     `.daylio` import) and [`plugins/sleep/server.ts`](../../../plugins/sleep/server.ts:627)
     (Sleep as Android CSV). For generic storage, insert rows into
     `plugin_checkins` with a stable dedupe column in `data` (as
     `mood_checkins.daylio_hash` does for its own table).
   - **JSON body with the raw text** (fine for small CSV exports): the client
     reads the file in the browser and POSTs `{ csv }` to a plugin `api`
     route that parses + transactionally upserts. Precedent:
     [`server/src/routes/import-yamtrack.ts`](../../../server/src/routes/import-yamtrack.ts:198)
     (+ [`server/src/services/yamtrack.ts`](../../../server/src/services/yamtrack.ts:1)).
   - **Background job for very large imports**: pair the upload route with
     the `jobs` hook — the route ingests the file, the `jobs` handler parses
     and inserts in batches, checks `isCancelled()` between batches, calls
     `updateProgress()`, and must NOT write the jobs row status itself
     (the framework owns it — see
     [`server/src/services/jobs.ts`](../../../server/src/services/jobs.ts:89)).
     A `dataSettings` client section (step 6) hosts the upload UI; it is
     rendered with `jobRefreshKey` / `onImportComplete` props.
3. **Repeatability**: make the import idempotent where possible (e.g.
   dedupe on a stable source id stored in `data`) so re-running a bad import
   doesn't double rows.
4. A standalone script under `plugins/<name>/scripts/` (like
   [`plugins/media/scripts/import-games-csv.ts`](../../../plugins/media/scripts/import-games-csv.ts:1))
   is optional for dev-time/CLI imports — add only if the user wants it.

### 5. Write `plugins/<name>/client.tsx` and register it

The client half (contract in [`shared/src/plugin.ts`](../../../shared/src/plugin.ts:524))
provides, at minimum:

- `icon` (a lucide-react icon) + `iconColor` — shown in the FAB and filters.
- `checkInPath` — route of the new check-in page, e.g. `'/workout-check-in'`.
  **No manual route registration needed**: [`client/src/App.tsx`](../../../client/src/App.tsx:63)
  auto-registers `checkInPath` for every plugin, plus the detail route —
  `detailPath` when declared, otherwise `/checkins/:pluginId/:id` rendering
  the generic [`PluginCheckInDetail`](../../../client/src/pages/PluginCheckInDetail.tsx:17).
- `hotkey` (single char) and `fabOrder` when the type is commonly logged
  (Home builds the FAB and hotkey map from the client registry).

**Omit** `checkInForm`, `timelineCard`, `detailPage`, `filterSection`,
`profileTab`, `settings` to get the framework-generated equivalents — this
alone satisfies the manual check-in, timeline card, and detail-page
requirements. Add components one at a time only when the auto UI is
insufficient:

- `profileTab` — **required in practice for the "stats and graphics"
  requirement**: the auto tab only shows a total count plus the most recent
  entry. Build charts from `GET /api/v1/plugins/<id>/checkins` (or a plugin
  `api` route) and follow the patterns in
  [`client/src/components/Stats.tsx`](../../../client/src/components/Stats.tsx:1)
  and existing tabs in
  [`client/src/pages/Profile.tsx`](../../../client/src/pages/Profile.tsx:1).
- `reflectionCard` — render each "On This Day" entry nicely; requires
  `reflectionBranch` on the server (step 2). The Reflect tab
  ([`client/src/components/ReflectTab.tsx`](../../../client/src/components/ReflectTab.tsx:1))
  picks both up automatically.
- `detailPage` + `detailPath` (e.g. `'/workout-checkins/:id'`) — the generic
  detail page at `/checkins/:pluginId/:id` already renders every field;
  customize only when layout demands it.
- `filterSection` — custom Home timeline filter controls (props contract:
  `PluginFilterSectionProps`). The default toggle covers basic needs; add this
  for range sliders, multi-select chips, etc.

Register in [`client/src/plugins/registry.ts`](../../../client/src/plugins/registry.ts:21)
exactly as on the server:

```ts
import { client as workoutsClient, manifest as workoutsManifest } from '../../../plugins/workouts/client';
// ...
{ ...workoutsManifest, client: workoutsClient },
```

### 6. Settings and integrations

- Declare every persisted setting in the **server** half's `settingsKeys`
  (`{ name, type: 'string'|'number'|'boolean'|'json', label, default? }`).
  The framework upserts declared keys only, in `plugin_settings` (unknown
  keys are rejected with 400). Client-side, read/write them with the
  `plugins.settings.get/set` helpers in
  [`client/src/plugins/api.ts`](../../../client/src/plugins/api.ts:58).
- **There is no auto-generated settings form** — a plugin with `settingsKeys`
  but no `settings` component gets no Settings tab. Ship a `settings` client
  section whenever you declare `settingsKeys`. It is rendered
  self-contained — [`client/src/pages/Settings.tsx`](../../../client/src/pages/Settings.tsx:137)
  injects no props (the `PluginSettingsProps` contract is not used by the
  shell), so the component fetches its own values via `plugins.settings.get`
  and persists via `plugins.settings.set` (see `plugins/mood/ui/MoodTab.tsx`).
- For third-party connections, add an `integrationsSettings` section
  (Settings > Integrations); for import/backfill controls, a `dataSettings`
  section (Settings > Data — see step 4).

### 7. Export/import (backup) verification

- **Generic storage: nothing to implement.** The framework exports/restores
  `plugin_checkins` rows under `plugins.<id>` in the backup, and start-over
  deletes them. Verify with the round-trip test in step 8.
- **Custom storage:** implement `backupExport` / `backupImport` (+
  `extraBackupTables` / `backupOrder` for secondary tables; FK-ordered;
  idempotent inserts).
- Never implement `restoreLegacyBackup` / `legacyBackupKeys` /
  `legacySettingsKeys` — those exist only for pre-plugin backups of migrated
  built-in types.
- Never delete `plugin_settings` rows in `deleteUserData` / `resetSettings` —
  the framework always handles those itself.

### 8. Build, test, and verify end-to-end

1. `npm run build --workspace=shared` (server consumes the built CJS package;
   the client consumes TS source).
2. Add an integration test modeled on
   [`server/tests/integration/generic-plugin.integration.test.ts`](../../../server/tests/integration/generic-plugin.integration.test.ts:16)
   (CRUD → validation rejection → timeline filter → backup round-trip →
   start-over) using `registerPlugin()` with your manifest. Run:
   `npm run test:integration --workspace=server`.
3. Manual acceptance pass — every one of these must work:
   - [ ] Manual check-in: create an entry of the new type via the FAB page.
   - [ ] Import: the example dataset imports and each element appears as a
         check-in.
   - [ ] Profile: the new tab shows stats/graphics for the dataset.
   - [ ] Reflect: "On This Day" shows entries of the new type.
   - [ ] Backup: data export contains the new type; restore on a clean DB
         reproduces it; start-over removes it.
   - [ ] Settings: new settings/integration UI appears and persists.
   - [ ] Detail: visiting a check-in shows the detail page.
   - [ ] Home timeline: the type's filter controls filter the timeline.

## Rules that prevent real breakage

- **Don't reimplement shared helpers** — the timeline envelope, WHERE
  building, import uploads, and `validatePluginData` already exist
  (see [`plans/plugin-authoring.md`](../../../plans/plugin-authoring.md:97)).
- **Plugins must not query other plugins' or core tables directly** —
  cross-plugin needs go through the shared contract hooks (e.g. timezone
  inference is a per-plugin `latestTimezoneAsOf` hook that integrations
  resolve by looping `allPlugins()`, as in
  [`plugins/sleep/server.ts`](../../../plugins/sleep/server.ts:400)), so a
  schema rename touches one file.
- **Use `DEFAULT_USER_ID`** from [`server/src/constants.ts`](../../../server/src/constants.ts:1)
  — never re-hardcode the UUID (single-user app).
- **Keep the manifest pure** — no React, no Node imports; it is bundled into
  both sides.
- **Custom SQL hooks take positional `$n` params** exactly as documented per
  hook; a wrong arity fails at request time, not build time.
- If the server consumes `wwp-shared` contract changes, rebuild the shared
  workspace before running the server.

## Troubleshooting

- **Server throws `Plugin id "x" is invalid` / `Duplicate check-in plugin id`**
  on boot — `id` fails `/^[a-z][a-z0-9_]*$/` or collides; fix the manifest.
- **New type missing from the timeline** — you registered the manifest but
  the server half is missing from `server/src/plugins/registry.ts` (or the
  client half from `client/src/plugins/registry.ts`).
- **Timeline rows appear but are misaligned** — a custom
  `buildTimelineSelect` drifted from the shared column envelope; rebuild it
  with `timelineColumnList()`.
- **400s on check-in create** — the payload fails `validatePluginData`
  against `fields` (wrong type, missing required, invalid `select` option).
- **Reflect empty** — `reflectionBranch` (server) is missing or its WHERE
  doesn't filter on `$1`/`$2`; a client-only `reflectionCard` is not enough.
- **Settings not persisting** — the key wasn't declared in the server
  `settingsKeys` (the framework upserts declared keys only).
- **Import runs but no rows** — check the parse adapter's timestamp mapping;
  `checked_in_at` must be a valid timestamptz and `data` must validate.
