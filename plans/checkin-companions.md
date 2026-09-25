# Shared Check-In Companions + Media Companions — Architecture & Implementation Plan

## 1. Overview

Two related changes:

1. **Move the companion database into the core.** Companions (people "with"
   on a check-in) previously lived in a location-plugin-owned table
   (`checkin_companions`, migration 046). The storage now lives in a single
   core-owned table shared by every check-in type that implements
   companions, along with a shared core service, a shared core autocomplete
   endpoint, and a shared client chip-input component.
2. **Add companions to Media check-ins**, matching the Location integration:
   chip input on the check-in form, display + edit on the detail page, and
   "Here with …" on the timeline card.

## 2. Core storage (migration `048_companions.sql`)

```sql
CREATE TABLE companions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_type TEXT NOT NULL,   -- plugin id, e.g. 'location', 'media'
  checkin_id UUID NOT NULL,     -- the plugin-owned check-in row's id
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (checkin_type, checkin_id, name)
);
CREATE INDEX idx_companions_checkin ON companions(checkin_type, checkin_id);
CREATE INDEX idx_companions_name    ON companions(name);
```

- No FK into plugin-owned check-in tables (the core cannot reference them);
  companion rows are cleaned up by the owning plugin on check-in delete and
  in its start-over/backup hooks.
- Existing `checkin_companions` rows are moved in with
  `checkin_type = 'location'`; the old table is dropped.
- The single-user app has one name pool across all types, so a name typed on
  any check-in type autocompletes on every other type.

## 3. Core service (`server/src/services/companions.ts`)

All SQL for the shared table lives here; plugins never hand-roll it.

- `normalizeCompanions(value)` — trim, drop empties, case-insensitive
  dedupe. The canonical payload normalization for all types.
- `getCompanions(type, checkinId, client?)` / `getCompanionsByCheckin(type, ids, client?)`
- `insertCompanions(type, checkinId, names, client?)` — idempotent (create path)
- `setCompanions(type, checkinId, names, client?)` — full replacement (edit path)
- `deleteCompanionsForCheckins(type, ids, client?)`
- `searchCompanionNames(q?, limit?, client?)` — distinct, ILIKE-filtered,
  alphabetically ordered names (autocomplete pool)
- `companionNamesSql(type, checkinIdColumn)` — scalar jsonb-array subquery
  for embedding in a SELECT (timeline branches). `type` must be a valid
  plugin id (the helper throws otherwise — injection guard).

`client?` is any `{ query }` executor (a pg PoolClient for transactional
use); when omitted the shared pool query is used.

## 4. Core API

- `GET /api/v1/companions/names?q=&limit=` (`server/src/routes/companions.ts`,
  mounted in `server/src/index.ts`) — the shared autocomplete endpoint,
  replacing the location plugin's `GET /location-checkins/companion-names`
  (removed).
- Client helper: `companions.names(q?, limit?)` in `client/src/api/client.ts`
  (replaces `checkins.companionNames`, removed).

## 5. Shared timeline envelope column

`server/src/plugins/timeline.ts` gains a `companions` column
(`NULL::json AS companions` by default, auto-filled for every branch).
Companion-aware types emit it via `companionNamesSql`:

- **Location**: `companions` column + the legacy `data.companions` jsonb
  (kept, since `plugins/location/client.tsx` still reads it).
- **Media**: `companions` column.

`client/src/types/index.ts` — `TimelineItem.companions?: string[] | null`.

## 6. Client component

`client/src/components/CompanionChipInput.tsx` — the "Here With…" chip input
moved out of the location plugin (old file deleted; tests moved to
`client/tests/components/CompanionChipInput.test.tsx`). Autocomplete now
fetches from the shared `companions.names()` helper, so the name pool is
cross-type. Used by both the location and media check-in forms.

## 7. Location plugin changes

- CRUD, delete, backup export/import, start-over, and timeline all go
  through the core service with `checkin_type = 'location'`.
- `DELETE /location-checkins/:id` now removes companion rows explicitly
  (the old table's FK cascade no longer applies).
- Backup payload key stays `checkinCompanions` (format compatibility).

## 8. Media plugin changes

Server (`plugins/media/server.ts`):

- `POST /media/items/:id/checkins` — accepts `companions: string[]`,
  inserts via `insertCompanions('media', …)`, echoes them back.
- `PUT /media/checkins/:id` — `companions` present ⇒ full replacement via
  `setCompanions`; every response now carries `companions`.
- `GET /media/items/:id/checkins` — each row carries `companions`
  (batched via `getCompanionsByCheckin`).
- `DELETE /media/checkins/:id` and `POST /media/items/bulk-delete` remove
  the companion rows.
- Timeline branch emits the shared `companions` column.
- Backup: new extra table `mediaCheckinCompanions`
  (`(checkin_id, name)` rows for the user's media check-ins), restored
  right after `mediaCheckins` in `backupOrder` so the check-in FK target
  exists. No FK to enforce — the restore ordering guarantees it.
- `deleteUserData` (start-over) deletes the user's media companion rows.
- Plex webhook / Yamtrack imports create check-ins without companions
  (unchanged behavior).

Client:

- `MediaCheckIn.companions?: string[]` (`plugins/media/ui/types.ts`);
  `createCheckin`/`updateCheckin` accept/send it (`plugins/media/ui/api.ts`).
- `MediaCheckInForm` (also used by the TV episode form) — "Here With…"
  `CompanionChipInput` above the notes field.
- `MediaDetail` check-ins table — display "with X, Y" under the date;
  edit mode includes the chip input and sends the full list on save
  (full-replacement semantics, same as location).
- `MediaCard` timeline card — "Here with X, Y" line above the notes.

## 9. Tests

- Core: `server/tests/services/companions.test.ts` (service + route).
- Location: `plugins/location/tests/enhancements.test.ts` updated for the
  shared table/SQL; `companion-names` endpoint test removed.
- Media: endpoint tests for companion create/update/list/delete in
  `plugins/media/tests/server.test.ts`; shape tests updated for the new
  backup table + start-over order.
- Client: chip-input tests moved to `client/tests/components/`.
- Integration (CI): media backup round-trip exercises the new
  `mediaCheckinCompanions` extra table automatically.
