# Location Check-In Enhancements — Architecture & Implementation Plan

## 1. Overview

Adds five features to the existing **Location** check-in plugin, modeled after the
Media plugin's equivalent features:

1. **Check-in star rating** — 1–4 stars or unrated, set at check-in time.
2. **Venue star rating** — 1–4 stars or unrated, an attribute of the venue itself
   (set from the venue detail page, similar to Media's item-level rating).
3. **Venue lists** — named lists venues can be added to / removed from
   (mirrors `media_lists` / `media_list_items`).
4. **"Here With…" companions** — on the check-in form, a chip input that
   autocompletes from previously-entered companion names. Stored on a new
   `checkin_companions` table.
5. **"All Venues" library section** at the bottom of `Profile > Places`,
   mirroring `MediaLibrarySection`. Sort by Last check-in / Rating / Check-in
   count; filter by name (text), list (dropdown), and venue category
   (text + autocomplete).

Confirmed decisions:
- Companion names: separate `checkin_companions (checkin_id, name)` table
  (normalized, leaves room to link to a future people entity).
- All Venues: **only venues with at least one check-in** (mirrors the Media
  library; includes unchecked venues only in the "all time" period, matching
  Media's behavior).
- All Venues respects the Places tab's existing period selector (same as
  `MediaLibrarySection` receiving `from`/`to` from `MediaTab`).

Rating semantics: `SMALLINT CHECK (rating IS NULL OR (rating >= 1 AND rating <= 4))`.
`NULL` = unrated. The existing [`ScorePicker`](client/src/components/ScorePicker.tsx)
(component already supports 0-4, where 0 = unrated) and
[`Stars`](client/src/components/Stars.tsx) (read-only 0-4 display) are reused
without modification.

## 2. Data Model (migration `046_location_enhancements.sql`)

```sql
-- 1) Check-in rating
ALTER TABLE checkins
  ADD COLUMN IF NOT EXISTS rating SMALLINT
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 4));

-- 2) Venue rating (item-level attribute, like media_items.rating)
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS rating SMALLINT
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 4));

-- 3) Companions (people "here with" on a check-in)
CREATE TABLE checkin_companions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id UUID NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (checkin_id, name)
);
CREATE INDEX idx_checkin_companions_checkin ON checkin_companions(checkin_id);
CREATE INDEX idx_checkin_companions_name    ON checkin_companions(name);

-- 4) Venue lists (mirrors media_lists / media_list_items)
CREATE TABLE venue_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name)
);
CREATE INDEX idx_venue_lists_user ON venue_lists(user_id);

CREATE TABLE venue_list_items (
  list_id UUID NOT NULL REFERENCES venue_lists(id) ON DELETE CASCADE,
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (list_id, venue_id)
);
CREATE INDEX idx_venue_list_items_venue ON venue_list_items(venue_id);
```

Notes:
- `checkin_companions` is owned by the location plugin's custom storage; it
  cascades on checkin delete (same behavior as `checkin_scrobbles`).
- `venue_lists` is user-scoped. `venue_list_items` cascades both ways
  (delete a list → drop memberships; delete a venue → drop memberships).
- Venues are shared reference data (not deleted on start-over), so list
  memberships for venues are kept; only the user's `venue_lists` rows are
  dropped on start-over (see §7).

## 3. Server Changes — [`plugins/location/server.ts`](plugins/location/server.ts)

### 3a. Check-in rating
- `POST /location-checkins` (create): read `rating` from body (int or null),
  persist it. Add `rating` to the `INSERT`.
- `PUT /location-checkins/:id` (update): read `rating`, include
  `rating = COALESCE($X, rating)` (or explicit null handling so the UI can
  clear to unrated — use a sentinel: if key present, set it; see implementation
  note below).
- `GET /location-checkins` and `GET /:id`: add `c.rating` to the SELECT list.

Implementation note for nullable rating on update: follow the existing
pattern of `notes = COALESCE($2, notes)` but allow explicit clear. The cleanest
approach that matches the codebase is to treat an absent key as "no change" and
an explicit `null` as "clear to unrated". Implement by checking
`'rating' in req.body` and building the SET clause accordingly (the same
technique is already needed for companions, so a small helper is worthwhile).

### 3b. Companions
- `POST /location-checkins`: accept `companions: string[]`. After inserting the
  check-in, bulk-insert rows into `checkin_companions` (deduped, trimmed,
  non-empty). Wrap in the same transaction as the check-in insert (use `pool`).
- `PUT /location-checkins/:id`: accept `companions: string[]` (full replacement
  semantics — delete all existing companions for the check-in, re-insert).
- `GET /:id`: return `companions: string[]` (ordered by name) alongside the
  check-in. `GET /` (list) may omit companions for payload size (detail page
  fetches the single check-in).
- New endpoint `GET /location-checkins/companion-names?q=<optional>&limit=50`:
  distinct companion names for the user, case-insensitive, optionally filtered
  by prefix/contains on `q`, ordered by most-recently-used then name. Used to
  power the autocomplete.
  - Implementation: `SELECT DISTINCT name FROM checkin_companions cc JOIN
    checkins c ON c.id = cc.checkin_id WHERE c.user_id = $1 [AND
    unaccent(cc.name) ILIKE '%q%'] ORDER BY name LIMIT n`.

### 3c. Venue rating
- `GET /venues/:id`: add `v.rating`.
- `POST /venues`: accept `rating`, persist (via the existing `findOrReuseVenue`
  path — extend it to accept/set `rating`, or set it in a follow-up UPDATE;
  prefer passing through `findOrReuseVenue` so reuse is idempotent).
- `PUT /venues/:id`: add `rating` to the `UPDATE`.
- `GET /venues` (list): add `v.rating`.

### 3d. Venue lists (mirrors the Media lists block)
Add a `listsRouter` mounted at `/venues/lists` (or inline on `venuesRouter`
before the `/:id` routes so `lists` isn't captured as an id):
- `GET  /venues/lists` — lists with their venues (id, name, added_at), like
  [`media GET /lists`](plugins/media/server.ts).
- `POST /venues/lists` — create `{ name }`.
- `PUT  /venues/lists/:id` — rename.
- `DELETE /venues/lists/:id` — delete.
- `POST   /venues/lists/:id/items` — add `{ venue_id }` (`ON CONFLICT DO NOTHING`).
- `DELETE /venues/lists/:id/items/:venueId` — remove.

Reuse the same `pool` transaction pattern as
[`media POST /lists/:id/items`](plugins/media/server.ts).

### 3e. All Venues library endpoint
- `GET /venues/library?from=&to=` — one row per venue **with at least one
  check-in** in range (or all venues with check-ins when no range), returning:
  `id, name, category_id, category_name, category_icon, address, city, state,
  country, rating, last_checkin_at, last_checkin_timezone, checkin_count,
  lists: string[] (list names this venue belongs to)`.
  - Join `checkins` (LEFT when no range, INNER when range given — mirror the
    Media `/library` includeUncheckedItems logic).
  - `lists` via a second aggregated query over `venue_list_items` +
    `venue_lists` (json_agg of list names), keyed by venue id.
  - Default `ORDER BY last_checkin_at DESC NULLS LAST` (client re-sorts).

### 3f. Plugin half / backup / start-over
- **backupExport** ([existing](plugins/location/server.ts)): add `rating` to the
  checkins SELECT; add `rating` to the venues SELECT; add a `companions`
  array (from `checkin_companions` for this user's check-ins, grouped by
  checkin_id) and `venueLists` / `venueListItems` arrays.
- **backupImport**: insert `rating` on checkins and venues; insert
  `checkin_companions` after check-ins (remap checkin ids if the restore
  changes them — they don't here, ids are preserved); insert `venue_lists`
  then `venue_list_items` (remap list ids via an id map like categories).
- **restoreLegacyBackup**: legacy payloads have no new keys — default to
  empty arrays / nulls so old restores still work.
- **deleteUserData**: also delete `checkin_companions` for the user's check-ins
  (before deleting check-ins) and delete the user's `venue_lists` (+ their
  `venue_list_items`). Venues themselves are kept (shared reference data), so
  venues' `rating` persists — acceptable and matches how venue data is treated
  today.

## 4. Client API — [`client/src/api/client.ts`](client/src/api/client.ts)
- `checkins.create` / `checkins.update`: accept `rating` and `companions`
  (the request body is already `any`, so this is mainly typing + docs).
- Add `checkins.companionNames(params?)` → `GET /location-checkins/companion-names`.
- `venues.get/list/create/update`: `rating` flows through (body is `any`).
- Add a `venueLists` API object: `list(), create(name), rename(id,name),
  delete(id), addVenue(listId, venueId), removeVenue(listId, venueId)`.
- Add `venues.library(params?)` → `GET /venues/library`.

## 5. Client UI — check-in rating + companions

### [`LocationCheckInForm.tsx`](plugins/location/ui/LocationCheckInForm.tsx)
- Add a **Rating** section using [`ScorePicker`](client/src/components/ScorePicker.tsx)
  (value 0-4; map 0 ↔ null when submitting). Show in both create and edit mode.
- Add a **"Here With…"** section: a chip input component (new, see below).
  - On submit (create): send `companions: string[]` and `rating: number|null`.
  - On submit (update): send the same (full-replace companions).
  - In edit mode, prefill `rating` and companions from the fetched check-in
    (populated by `LocationCheckIn.tsx` via `checkins.get`).
- Pass the initial check-in's `rating` / `companions` down as props from
  [`LocationCheckIn.tsx`](plugins/location/ui/LocationCheckIn.tsx)
  (`initialRating`, `initialCompanions`).

### New component [`plugins/location/ui/CompanionChipInput.tsx`]
- Chip input: a text field inside a container that shows selected companions
  as removable chips; typing filters a dropdown of suggestions from
  `checkins.companionNames({ q })` (debounced, like the venue merge search).
  - Enter (or selecting a suggestion) adds a chip with that name and clears
    the input. Backspace on empty input removes the last chip. Each chip has
    an X to remove.
  - `value: string[]`, `onChange(names)`. Case-insensitive dedupe on add.

### Display
- [`LocationCard.tsx`](plugins/location/ui/LocationCard.tsx): show a
  [`Stars`](client/src/components/Stars.tsx) (when `checkin.rating`) and a
  "Here with …" line (comma-joined `checkin.companions`) when present.
- [`LocationCheckInDetail.tsx`](plugins/location/ui/LocationCheckInDetail.tsx):
  same display (rating + companions) in the main card. The detail page fetches
  the single check-in, so it already gets `companions` from `GET /:id`.
- Ensure the timeline/card data source includes `rating` and `companions` where
  they are displayed. (Timeline items come from `buildTimelineSelect` — add
  `c.rating` and a `companions` array to the `data` jsonb if cards on Home
  should show them; otherwise fetch per-card. Prefer adding to the timeline
  `data` jsonb for the home feed, since `companions` on the feed is cheap via
  `json_agg`.)

## 6. Client UI — venue rating + venue lists

### [`VenueDetail.tsx`](plugins/location/ui/VenueDetail.tsx)
- **Rating**: in edit mode, add a [`ScorePicker`](client/src/components/ScorePicker.tsx)
  bound to `editRating`; send `rating` on `saveEdit` (extend `venues.update`
  payload). Show current rating via [`Stars`](client/src/components/Stars.tsx)
  in the read-only header (when set).
- **Lists**: a "Lists" panel (similar to the existing Merge panel) letting the
  user:
  - see which lists this venue is in (from `venueLists.list()`),
  - add to an existing list (`venueLists.addVenue`),
  - create a new list and add the venue,
  - remove from a list (`venueLists.removeVenue`).

## 7. Client UI — All Venues library section

### New component [`plugins/location/ui/VenuesLibrarySection.tsx`]
Modeled on [`MediaLibrarySection.tsx`](plugins/media/ui/MediaLibrarySection.tsx):
- Props: `from`, `to` (the Places period range).
- State: `sortBy ∈ {last_checkin, rating, checkin_count}`, `sortDir`,
  `filterQuery` (name), `selectedListId` (list dropdown), `filterCategory`
  (category text + autocomplete).
- Data: `venues.library({ from, to })` + `venueLists.list()` (for the list
  dropdown and "in list" filtering) + `venues.categories()` (for the category
  autocomplete).
- Sort options: **Last check-in**, **Rating**, **Check-in count** (asc/desc
  toggle). Mirror the `sortValue` helper.
- Filters:
  - **Name**: text field (client-side substring match on `name`).
  - **List**: `<select>` of venue lists; filters to venues in that list
    (client-side via each row's `lists` array).
  - **Category**: text field with autocomplete over `venues.categories()`
    (filter client-side on the category name; suggest matching category names
    as you type).
- Row: venue name (link to `/venues/:id`), category badge, [`Stars`](client/src/components/Stars.tsx)
  for `rating`, `checkin_count`, formatted last check-in.

### Wire into [`PlacesTab.tsx`](plugins/location/ui/PlacesTab.tsx)
- Render `<VenuesLibrarySection from={placesVisibleRange.from} to={placesVisibleRange.to} />`
  at the bottom of the `PlacesTab` return, after `<CountriesList />` — i.e. the
  bottom of `Profile > Places`.

## 8. Types
- Extend the shared location types (in
  [`client/src/types/index.ts`](client/src/types/index.ts) or a local
  `plugins/location/ui/types.ts`): add `rating?: number|null` and
  `companions?: string[]` to the `CheckIn` shape; add `rating` to `Venue`; add
  `VenueList`, `VenueListItemRef`, `VenueLibraryItem` interfaces (mirror the
  Media equivalents in [`plugins/media/ui/types.ts`](plugins/media/ui/types.ts)).

## 9. Tests
- **Server** ([`plugins/location/tests/server.test.ts`](plugins/location/tests/server.test.ts)):
  - rating persisted on create/update and returned on get (incl. clear-to-null).
  - companions created on create, replaced on update, returned on get; cascade
    delete with the check-in; `companion-names` endpoint returns distinct names
    and filters by `q`.
  - venue lists CRUD + add/remove venue (idempotent add).
  - `venue rating` persisted via POST/PUT and returned on GET.
  - `/venues/library` returns only venues with check-ins; respects `from`/`to`;
    includes `lists` and `checkin_count`.
  - backup export/import round-trips rating + companions + venue lists;
    legacy backup (no new keys) still imports.
- **Client**:
  - `CompanionChipInput` unit test: typing → suggestions; Enter adds chip;
    backspace removes last; dedupe.
  - `VenuesLibrarySection` render test: sort + name/list/category filtering.
  - `LocationCheckInForm` test: submitting sends `rating` and `companions`.

## 10. Out of scope / notes
- No new people entity; companions are free-form names on
  `checkin_companions` (schema leaves room to add a `person_id` later).
- Venue `rating` is not backed into any stats endpoint beyond the library;
  existing stats endpoints are unchanged.
- Swarm import and venue backfill jobs are unaffected (they don't set rating /
  companions / lists).
