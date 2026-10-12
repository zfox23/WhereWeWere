---
name: create-checkin-plugin
description: "Use when creating or scaffolding a new check-in type plugin for WhereWeWere — a folder under `plugins/` with a manifest, server half, and client half, registered in both per-side registries."
---

# Check-in Type Plugin Skill

## What a plugin is

A **check-in type plugin** is a build-time TypeScript module that contributes a new check-in type (e.g. "Mood", "Scuba") to the WhereWeWere app. It is **not** a separate package or installable extension — it is a folder of source files joined to the app at build time by a shared plugin `id`.

Each plugin lives in its own folder `plugins/<name>/` with three entry files:

- **`manifest.ts`** — Pure data: `id`, `version`, `fields`, `strings`, plus optional `filterParams` and `startOver`. Importable by both client and server (no React, no Node).
- **`server.ts`** — Exports `server: CheckinTypeServerPlugin` (storage, timeline SQL, filters, backup/restore, settings schema, cross-cutting service hooks).
- **`client.tsx`** — Exports `client: CheckinTypeClientPlugin` (UI components, check-in form, profile tab, settings section).

Both halves are registered in per-side registries and joined by the plugin `id`.

Current plugins: `mood`, `sleep`, `tracks`, `location`, `media`, `scuba`.

> The canonical deep-dive for authors is [`plans/plugin-authoring.md`](../../plans/plugin-authoring.md) — it covers storage-mode decisions, the cross-cutting hook table, and the migration/legacy notes. Use this skill as the structural map; use that doc for judgment calls.

## File Layout

```
plugins/<name>/
  manifest.ts              # pure data: id, version, fields, strings, filterParams?, startOver?
  server.ts                # exports `server: CheckinTypeServerPlugin`
  client.tsx               # exports `client: CheckinTypeClientPlugin`
  ui/                      # (convention) client React components, split by concern
  ui/api.ts                # (convention) fetch helpers for plugin-owned API routes
  services/                # (convention) server-side logic (parsers, external APIs)
  scripts/                 # (convention) one-off maintenance/backfill scripts
  tests/                   # unit + client tests
  tests/integration/       # DB-backed integration tests
```

Plugin-owned server imports use relative paths into the server source, e.g.
`import { query } from '../../server/src/db';` — see `plugins/scuba/server.ts`.

## Registration

**Server** — `server/src/plugins/registry.ts`:

```ts
import { server as <name>Server } from '../../../plugins/<name>/server';
import { manifest as <name>Manifest } from '../../../plugins/<name>/manifest';
// ...
const registrations: CheckinTypeServer[] = [
  // ...
  { ...<name>Manifest, server: <name>Server },
];
```

**Client** — `client/src/plugins/registry.ts`:

```ts
import { client as <name>Client, manifest as <name>Manifest } from '../../../plugins/<name>/client';
// ...
const registrations: CheckinTypeClient[] = [
  // ...
  { ...<name>Manifest, client: <name>Client },
];
```

Both registries validate `id` against `PLUGIN_ID_PATTERN` (`/^[a-z][a-z0-9_]*$/`) and throw on duplicate ids. Server registry exports: `allPlugins()`, `getPlugin(id)`, `hasPlugin(id)`, `pluginIds()`, `registerPlugin(plugin)` (tests only — must run before the Express app is built, since routes capture branch lists at startup), plus SQL-branch helpers `earliestDateSources()`, `pluginTimestampUnion(indent)`, `pluginReflectionBranches()`. Client registry exports: `allClientPlugins()`, `getClientPlugin(id)`, `hasClientPlugin(id)`, `pluginDetailPath(pluginId, checkinId)`, `timelineDetailPath(item)`.

## Manifest Structure

Defined in `shared/src/plugin.ts` as `CheckinTypeManifest`:

```ts
export const manifest: CheckinTypeManifest = {
  id: '<name>',            // /^[a-z][a-z0-9_]*$/ — used in routes, timeline `type`,
                           // plugin_checkins.plugin_id, plugin_settings.plugin_id
  version: '1.0.0',        // semver
  filterParams: ['<key>'], // optional — Home timeline URL query params scoped into
                           // the plugin's timeline WHERE by the framework
  fields: [ /* PluginField[] — required, see below */ ],
  strings: {               // CheckinTypeStrings — required
    title: 'Name',         // e.g. "Mood" — FAB, filters, tab bar
    singular: 'name check-in',
    plural: 'name check-ins',
    newCheckIn: 'Header of the new check-in page',
    profileTab: 'Names',   // profile tab label
    confirmDelete: 'Are you sure you want to delete this name check-in?',
  },
  startOver: {             // optional — Settings > Danger Zone options
    deleteLabel: 'All Name check-ins',          // label override
    allData: { label: '...', description: '...' }, // extra checkbox -> server deleteAllData
  },
};
```

### Field Schema

Defined in `shared/src/fields.ts`. The `fields` array is the single source of truth: the server validates stored `data` against it (`validatePluginData()` from `wwp-shared`), generic storage persists it as JSONB, and the auto UIs render from it.

```ts
interface PluginField {
  name: string;        // machine-safe key in the data object; unique within plugin
  kind: 'text' | 'textarea' | 'number' | 'integer' | 'boolean'
      | 'date' | 'datetime' | 'rating' | 'select' | 'multi-select';
  label: string;
  required?: boolean;
  placeholder?: string;
  default?: unknown;
  min?: number; max?: number; step?: number;
  unit?: string;       // suffix, e.g. "km"
  options?: PluginFieldOption[];   // select / multi-select / rating: { value, label, icon? }
  isTimestamp?: boolean;            // date/datetime: authoritative for check-in timestamp
}
```

## Server Half

Defined in `shared/src/plugin.ts` as `CheckinTypeServerPlugin`. The key decision is `storage`:

- **`'generic'` (default — prefer this)** — The framework persists check-ins in the shared `plugin_checkins` JSONB table and provides for free: CRUD API at `/api/v1/plugins/<id>/checkins` (schema-validated), the unified timeline branch, `filterParams` scoping (string equality on `data` keys; numeric compare for number/integer/rating), backup export/restore, start-over, and automatic detail/profile rendering. The server half can be `{}` (plus any optional hooks). Reference implementations: `plugins/scuba/server.ts` (generic storage + extra API routes + hooks), `plugins/mood/server.ts`, `plugins/sleep/server.ts`.
- **`'custom'`** — The plugin owns its tables (created by a numbered migration in `server/src/db/migrations/`) and **must** implement `buildTimelineSelect`, `buildTimelineWhere`, `backupExport`, `backupImport`, and `deleteUserData`. Reference: `plugins/location/server.ts`, `plugins/media/server.ts`, `plugins/tracks/server.ts`.

```ts
export const server: CheckinTypeServerPlugin = {
  storage: 'generic' | 'custom',

  // ---- Custom storage only ----
  buildTimelineSelect?: () => { sql: string; postProcess?: (rows: unknown[]) => unknown[] },
    // Single SELECT producing the timeline envelope; use
    // timelineColumnList() from server/src/plugins/timeline.ts so the branch
    // matches TIMELINE_COLUMNS exactly. Framework appends
    // `WHERE <where> ORDER BY checked_in_at DESC LIMIT/OFFSET`.
    // postProcess: optional row-level JS hook (e.g. inferring timezone from
    // coordinates) applied to this branch's rows; must return them in order.
  buildTimelineWhere?: (ctx: PluginTimelineContext) => PluginFilterClause,
    // Combine user/date/search + this plugin's filterParams. Positional $n.
    // Use timelineWhereConditions() / createSqlConditions() from
    // server/src/plugins/sql.ts.

  // ---- API routes (either storage mode) ----
  api?: PluginApiMount | PluginApiMount[],
    // { mount: '/<name>', router } — mounted at /api/v1<mount>. Custom-storage
    // plugins own their CRUD this way; generic plugins may add extra mounts
    // (stats, imports, webhooks) alongside the framework's checkins routes.

  // ---- Backup / start-over ----
  extraBackupTables?: { table, select, insert, userIdFirst? }[], // custom: idempotent inserts
  backupOrder?: string[],                 // restore order for FKs ('primary' + table names)
  legacyBackupKeys?: string[],            // ONLY when migrating a built-in type
  backupExport?: (ctx: PluginHookContext) => Promise<unknown>,   // custom
  backupImport?: (ctx, payload) => Promise<number>,              // custom
  backupFiles?: (ctx) => Promise<BackupFilesResult>,  // backup v2 ZIP file bundles
                                                     // (e.g. tracks ships .gpx files)
  deleteUserData?: (ctx) => Promise<number>,           // custom start-over hook
  deleteAllData?: (ctx) => Promise<number>,  // wipe everything incl. shared/reference
                                             // data (paired with manifest startOver.allData)
  restoreLegacyBackup?: (ctx, data) => Promise<...>,    // ONLY when migrating a built-in
  resetSettings?: (ctx) => Promise<number>,  // start-over: clear user-scoped auxiliary
                                             // tables (never touch plugin_settings)
  settingsKeys?: PluginSettingsKey[],      // keys in plugin_settings: { name, type, label, default? }

  // ---- Cross-cutting service hooks (all optional, opt-in) ----
  resolveTimestamps?: () => { sql },    // (id, checked_in_at) for $1 uuid[] — photo/scrobble anchoring
  latestTimezoneAsOf?: () => { sql },   // one timezone text col for $1 refTime, $2 user_id
  reflectionBranch?: () => { sql },     // "this day in previous years"; $1 user_id, $2 date
  earliestDate?: () => { sql },         // single date text col for $1 — all-time period selector
  llm?: { label, gather, toLines },     // contribute to the LLM life summary
  reconcile?: PluginReconciliationHook, // timezone reconciliation tool participation
  jobs?: PluginJobDefinition[],         // background jobs: { jobType, handler(ctx) } with
                                        // ctx = { jobId, isCancelled, updateProgress }
  legacySettingsKeys?: string[],        // ONLY when migrating a built-in type
};
```

`PluginHookContext` provides `{ user_id, client?, errors?, filesDir? }` — hooks MUST run on the provided transaction `client` when present (atomicity), and restore hooks should push skip messages to `errors` instead of failing.

**Rules:**
- Plugins must NOT query other plugins' tables directly. Cross-plugin needs go through the shared contract hooks (integrations loop `allPlugins()`, e.g. timezone inference).
- Do NOT delete `plugin_settings` rows in `deleteUserData`/`resetSettings` — the framework always does that itself.
- Use `DEFAULT_USER_ID` from `server/src/constants.ts` (single-user app; don't re-hardcode the UUID).
- Import file uploads: `createImportUpload()` / `removeImportFile()` from `server/src/plugins/uploads.ts`.
- Timeline SQL helpers: `TIMELINE_COLUMNS` / `timelineColumnList()` from `server/src/plugins/timeline.ts`; `createSqlConditions()` / `timelineWhereConditions()` from `server/src/plugins/sql.ts`. Hand-rolled column lists desync the UNION branches.

## Client Half

Defined in `shared/src/plugin.ts` as `CheckinTypeClientPlugin`. Every component is optional — the framework ships defaults. Slot them in one at a time:

```ts
export const client: CheckinTypeClientPlugin = {
  icon: SomeIcon,        // REQUIRED — lucide-react icon (FAB, filters, etc.)
  iconColor?: 'text-green-500',   // Tailwind text color class
  hotkey?: 'm',              // single-keyboard-char hotkey on Home
  fabOrder?: 100,            // expandable FAB ordering (lower = first)
  checkInPath: '/name-check-in',   // REQUIRED — new check-in page route
  detailPath?: '/name-checkins/:id',
    // omit -> app routes to /checkins/:pluginId/:id with the generic detail page
  checkInForm?: Component,    // omit -> AutoCheckInForm generated from fields
  detailPage?: Component,     // omit -> generic detail page generated from fields
  timelineCard?: Component,   // omit -> AutoCheckInCard generated from fields
  filterSection?: Component,  // omit -> plain "include this type" toggle
  profileTab?: Component,     // omit -> AutoProfileTab (count + most recent entry)
  settings?: Component,       // omit -> NO settings section (there is no auto form;
                              // the component renders self-contained from declared
                              // settingsKeys via the plugin settings API)
  reflectionCard?: Component, // omit -> minimal generic chip
  integrationsSettings?: Component,  // Settings > Integrations section
  dataSettings?: Component,          // Settings > Data section
};
```

Default components live in `client/src/plugins/`: `autoForm.tsx`, `autoCard.tsx`, `autoProfileTab.tsx`. Client fetch helpers can live in the plugin's own `ui/api.ts` (see `plugins/scuba/ui/api.ts`, `plugins/sleep/ui/api.ts`).

## Framework Routes (generic storage)

Mounted by the framework (`server/src/plugins/routes.ts`):

- `GET    /api/v1/plugins` — list registered plugin metadata
- `GET    /api/v1/plugins/:pluginId` — plugin manifest (fields, strings)
- `GET    /api/v1/plugins/:pluginId/checkins` — list (limit/offset)
- `POST   /api/v1/plugins/:pluginId/checkins` — create (schema-validated against `fields`)
- `GET    /api/v1/plugins/:pluginId/checkins/:id`
- `PUT    /api/v1/plugins/:pluginId/checkins/:id`
- `DELETE /api/v1/plugins/:pluginId/checkins/:id`
- `GET    /api/v1/plugins/:pluginId/settings` — effective settings (defaults applied)
- `PUT    /api/v1/plugins/:pluginId/settings` — upsert declared keys only

Custom-storage plugins do not use the checkins endpoints; they own their CRUD via `server.api`.

## Creating a New Plugin — Step-by-Step

1. **Decide storage mode.** Generic unless the type genuinely needs its own tables.
2. **Create the folder** `plugins/<name>/` with `manifest.ts`, `server.ts`, `client.tsx`.
3. **`manifest.ts`**: `id`, `version`, `fields` (full data shape), `strings`, optional `filterParams`.
4. **`server.ts`**: `export const server: CheckinTypeServerPlugin = { ... }` — `{}` is valid for generic storage; add API mounts, `settingsKeys`, and cross-cutting hooks as needed.
5. **`client.tsx`**: `export const client: CheckinTypeClientPlugin = { icon, checkInPath, ... }` — start with just `icon` + `checkInPath` and let the auto UIs render.
6. **Register both halves** in `server/src/plugins/registry.ts` and `client/src/plugins/registry.ts`.
7. **(Custom storage only)** Add a numbered migration to `server/src/db/migrations/` and implement the required custom-storage hooks.
8. **Test.** Unit tests in `plugins/<name>/tests/`; add an integration test that registers the plugin via `registerPlugin()` (before the Express app is built) and exercises CRUD → timeline → backup round-trip → start-over. Template: `server/tests/integration/generic-plugin.integration.test.ts`; fixture: `server/tests/fixtures/genericPlugin.ts`. Run: `npm run test:integration --workspace=server`.

## Shared Contract & Build Notes

- The whole contract (manifest, server, client, field types, hook types) lives in `shared/src/plugin.ts` + `shared/src/fields.ts` and is exported from `wwp-shared`.
- `wwp-shared` is a workspace: the **server consumes the built CJS package**, the client consumes TS source. After editing shared types, rebuild: `npm run build --workspace=shared` (also runs automatically via `predev`/`prebuild`).
- Useful shared helpers: `validatePluginData(fields, data)`, `isValidTimeZone(tz)`, `PLUGIN_ID_PATTERN`, `isValidPluginId(id)`.
- Monorepo workspaces: `shared`, `server`, `client` (npm workspaces, root `package.json`).

## Minimal Generic Plugin Example

```ts
// plugins/<name>/manifest.ts
import type { CheckinTypeManifest } from 'wwp-shared';

export const manifest: CheckinTypeManifest = {
  id: '<name>',
  version: '1.0.0',
  fields: [
    { name: 'some_value', kind: 'text', label: 'Some value' },
  ],
  strings: {
    title: 'Name',
    singular: 'name check-in',
    plural: 'name check-ins',
    newCheckIn: 'New name check-in',
    profileTab: 'Names',
    confirmDelete: 'Delete this name check-in?',
  },
};
```

```ts
// plugins/<name>/server.ts
import type { CheckinTypeServerPlugin } from 'wwp-shared';

export const server: CheckinTypeServerPlugin = {
  storage: 'generic',
  // Nothing else required: the framework provides CRUD, timeline,
  // backup/restore, and start-over for the plugin_checkins table.
};
```

```tsx
// plugins/<name>/client.tsx
import { Sparkles } from 'lucide-react';
import type { CheckinTypeClientPlugin } from 'wwp-shared';

export const client: CheckinTypeClientPlugin = {
  icon: Sparkles,
  checkInPath: '/name-check-in',
  // No components: AutoCheckInForm, AutoCheckInCard, the generic detail
  // page, and AutoProfileTab are rendered from the manifest fields.
};
```

Then register in both registries and the type is fully functional: check-in form, timeline card, filters (type toggle), detail page, profile tab, backup, and start-over.
