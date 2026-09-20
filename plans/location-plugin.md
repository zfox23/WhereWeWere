# Location check-in → plugin migration

Goal: the Location check-in type **and the entire venues subsystem** live entirely in
`plugins/location/`. After the migration, no Location-check-in- or venue-related code
remains in the core platform (server, client, shared). Follows the Mood/Sleep/Tracks
precedent (custom storage), with three approved framework extensions.

## Decisions (confirmed with user)

1. **Venues move too.** `venues`, `venue_categories`, venue search (Overpass/Nominatim),
   venue merge, Places tab, `/venues/:id`, Swarm import — all become plugin-owned.
2. **Plugin-native URLs.** CRUD → `/api/v1/location-checkins`, location stats →
   `/api/v1/location-checkins/stats/*`. Core `/api/v1/checkins` is deleted.
   `/api/v1/venues`, `/api/v1/search`, `/api/v1/import/swarm` keep their URLs as plugin
   mounts (client-side unchanged). The core `/stats` route survives with only its
   *generic* endpoints (`/reflections`, `/earliest-dates` — both already plugin-hook-driven).
3. **Reconciliation special-casing dropped.** Location participates as a normal plugin
   anchor — no "nearest venue within 24h" preference.
4. **Framework extensions (approved):**
   - `buildTimelineSelect` may return an optional `postProcess?: (rows) => rows` for the
     legacy `geo-tz` fallback on missing `checkin_timezone`.
   - New `latestTimezoneAsOf?: () => { sql }` server hook (`$1` referenceTime, `$2`
     user_id, returns one `timezone` text column). `webhook-plex.ts` loops plugins;
     `server/src/plugins/coreCheckins.ts` is deleted.
   - New `jobs?: PluginJobDefinition[]` server hook (`{ jobType, label?, handler }`);
     the jobs route dispatches by jobType; core keeps only the generic job lifecycle
     (job_runs, progress, cancel) and exports `isJobCancelled` / `updateJobProgress` /
     `completeJob` / `failJob` helpers for plugin handlers.

## New plugin structure

```
plugins/location/
  manifest.ts        id 'location', filterParams ['venue_id','category','country'],
                     fields [venue_id (string, required), notes (textarea)],
                     strings (title 'Location', profileTab 'Places', ...)
  server.ts          storage: 'custom'
    api mounts:
      /location-checkins            CRUD (from routes/checkins.ts)
      /location-checkins/stats/*    summary, top-venues, category-breakdown, heatmap,
                                    monthly, countries, map-data, day-of-week,
                                    time-of-day, busiest-days, top-cities, additional-stats
                                    (from routes/stats.ts)
      /venues                       (from routes/venues.ts, incl. /nearby, /categories,
                                    /place-search, /:id/merge-into, /import-osm,
                                    /geocode, /categorize)
      /search                       (from routes/search.ts — only searches venues+checkins)
      /import/swarm                 (from routes/import.ts)
    hooks:
      buildTimelineSelect (+ postProcess geo-tz) / buildTimelineWhere
      backupExport/backupImport (checkins), extraBackupTables (venueCategories, venues),
        backupOrder ['venueCategories','venues','primary']
      legacyBackupKeys ['checkins','venues','venueCategories'] + restoreLegacyBackup
      deleteUserData (checkin_scrobbles for user's checkins, then checkins)
      reflectionBranch, earliestDate, resolveTimestamps, latestTimezoneAsOf,
      llm, reconcile (scanAll, detailPath /checkins/:id, no 24h preference)
      jobs: [{ jobType 'venue-backfill', handler }] (+ whatever job types the venue
        /geocode + /categorize endpoints start today)
    services/          nominatim.ts, overpass.ts, venueMerge.ts (moved)
    scripts/           backfill-checkin-timezone.ts (moved from server/src/db/, wired
                       like tracks/scripts/*)
  client.tsx           icon MapPin, iconColor 'text-primary-500', hotkey 'l',
                       fabOrder 10 (keeps first FAB slot), checkInPath '/check-in',
                       detailPath '/checkins/:id'
    checkInForm / detailPage / timelineCard / filterSection (LocationFilter) /
    profileTab (PlacesTab) / reflectionCard / dataSettings (SwarmImportSection)
  ui/                  LocationCheckIn (from pages/CheckIn.tsx), LocationCheckInDetail,
                       LocationCard (from components/CheckInCard.tsx), LocationFilter,
                       PlacesTab (from components/PlacesTab.tsx + location dashboard in
                       components/Stats.tsx), VenueDetail, VenueSearch, VenueEditMap,
                       MapView, SwarmImportSection, LocationYearInPixels (Heatmap
                       rendering for ReflectTab), LocationContext, geo.ts
                       (haversine/tiles/distance from utils/geo.ts), api.ts, types.ts
  tests/               server.test.ts, integration/location.integration.test.ts,
                       venueMerge.test.ts (moved), LocationCard/LocationFilter client tests
```

## Core framework changes (approved)

- [`shared/src/plugin.ts`](shared/src/plugin.ts): `postProcess` on `buildTimelineSelect`
  return; `latestTimezoneAsOf` hook; `jobs` hook + `PluginJobDefinition` type.
  Rebuild `shared` (`npm run build --workspace=shared`).
- [`server/src/routes/jobs.ts`](server/src/routes/jobs.ts) +
  [`server/src/services/jobs.ts`](server/src/services/jobs.ts): plugin job dispatch;
  delete `geocodeBatch`/`categorizeBatch`; export job-lifecycle helpers.

## Server core — pure removals

| File | Change |
|---|---|
| `server/src/routes/checkins.ts` | **Delete** (moves to plugin) |
| `server/src/routes/venues.ts` | **Delete** (moves to plugin) |
| `server/src/routes/import.ts` | **Delete** (moves to plugin) |
| `server/src/routes/search.ts` | **Delete** (moves to plugin) |
| `server/src/routes/stats.ts` | Remove 12 location endpoints + `/additional-stats` + `locationBranch` in `/reflections`; keep `/reflections` + `/earliest-dates` |
| `server/src/plugins/coreCheckins.ts` | **Delete**; `webhook-plex.ts` loops `latestTimezoneAsOf` hooks |
| `server/src/services/timestampReconciliation.ts` | Remove venue load/apply/suggestion + 24h preference; location flows through `reconcile` hook |
| `server/src/routes/immich.ts`, `scrobbles.ts` | Drop hard-coded `FROM checkins` branch (plugin `resolveTimestamps` UNION already wired) |
| `server/src/routes/llm.ts` | Remove location query + pool (plugin `llm` hook) |
| `server/src/routes/backup.ts` | Remove checkins/venues/venueCategories export+import, `delete_venue_checkins` option (becomes generic `delete_location_checkins`), checkin_scrobbles cascade (into `deleteUserData`) |
| `server/src/plugins/registry.ts` | Register location plugin; delete `BUILTIN_EARLIEST_DATES` (plugin `earliestDate` hook; response key `checkins` → `location`) |
| `server/src/routes/timeline.ts` | Remove location branch, `addTimezone`, `hasLocationTypeFilter` special-case (filterParams machinery covers it); apply per-branch `postProcess` |
| `server/src/index.ts` | Remove 4 core mounts (`/checkins`, `/venues`, `/search`, `/import/swarm`) |
| `server/src/services/{nominatim,overpass,venueMerge}.ts` | **Delete** (moved to plugin) |
| `server/src/db/backfill-checkin-timezone.ts` | **Move** to `plugins/location/scripts/` |

## Client core — pure removals

| File | Change |
|---|---|
| `client/src/pages/CheckIn.tsx`, `CheckInDetail.tsx` | **Delete** (moved) |
| `client/src/App.tsx` | Remove `/check-in`, `/checkins/:id` routes + `EXPLICIT_PATHS` (plugin registers both); remove `LocationProvider` (self-contained in plugin pages); keep `/venues/:id` importing the plugin's `VenueDetail` (MoodYearInPixels precedent) |
| `client/src/pages/Home.tsx` | Remove `'location'` from `LEGACY_TYPE_IDS`, `includeLocation` state machine, hard-coded Location FAB entry + hotkey, `CheckInCard` dispatch, category/country option fetch |
| `client/src/components/filters/Filters.tsx` | Remove location filter panel + related props |
| `client/src/pages/Profile.tsx` | Remove hard-coded `places` tab (plugin `profileTab`); default tab → `plugin:location` |
| `client/src/components/ReflectTab.tsx` | Location heatmap → import `LocationYearInPixels` from plugin; render location reflection items via the plugin's `reflectionCard` (same generic pattern as mood/sleep) |
| `client/src/components/Stats.tsx` | Keep generic exports (`StatCard`); move location dashboard + `Heatmap`/`TopVenuesList` etc. into plugin ui |
| `client/src/components/{CheckInCard,CheckInForm,MapView,VenueSearch,VenueEditMap,PlacesTab}.tsx`, `contexts/LocationContext.tsx`, `pages/VenueDetail.tsx`, `pages/settings/SwarmImportSection.tsx`, `utils/geo.ts` | **Delete** (moved to plugin) |
| `client/src/pages/settings/DataTab.tsx` | Drop `SwarmImportSection` import (plugin `dataSettings`) |
| `client/src/pages/settings/StartOverSection.tsx` | Drop hard-coded `delete_venue_checkins` (generic per-plugin checkbox covers it) |
| `client/src/api/client.ts`, `types/index.ts` | Move `checkins`, `venues`, location `stats.*` APIs + `CheckIn`/`Venue`/`TopVenue`/`Stats` types into plugin `ui/api.ts` / `ui/types.ts`; `earliestDates` key `checkins` → `location` |

**Stays core (shared, not location-specific):** `utils/checkin.ts`, `components/checkin-card/*`
(generic card shell used by mood/sleep/tracks), `shared/`, `MediaCard`/media code.

## Behavior changes (accepted)

- `/api/v1/checkins` → `/api/v1/location-checkins` (external consumers break — approved).
- Location `/api/v1/stats/*` → `/api/v1/location-checkins/stats/*`.
- `earliest-dates` response key `checkins` → `location`.
- Reconciliation loses the 24h venue-anchor preference.
- FAB: Location moves from the hard-coded slot into the generic plugin list (`fabOrder: 10`
  preserves its first position; hotkey `L` preserved).

## Testing

- **New plugin suites** (mirror Mood/Tracks):
  - `plugins/location/tests/server.test.ts` — pure logic (tz inference, geo fallback,
    filter WHERE building).
  - `plugins/location/tests/integration/location.integration.test.ts` — template
    `server/tests/integration/generic-plugin.integration.test.ts` + Mood: manifest
    registration, CRUD at `/location-checkins`, venues CRUD/merge, timeline branch +
    `venue_id`/`category`/`country` filters + `postProcess` tz fallback, stats endpoints,
    search, Swarm import, backup round-trip (incl. venues/venueCategories + legacy
    restore), start-over (`delete_location_checkins` + scrobble cascade), reconcile hook,
    earliest-dates `location` key, Plex webhook tz inference via `latestTimezoneAsOf`.
  - Client: `LocationCard` / `LocationFilter` component tests (Tracks precedent).
- **Move:** `server/tests/services/venueMerge.test.ts`, `client/tests/components/CheckInForm.test.tsx`.
- **Update:** `server/tests/integration/api.integration.test.ts` (new URLs),
  `server/tests/services/timestampReconciliation.test.ts` (venue query gone), backup
  round-trip tests (keys claimed by plugin payload).
- **Finish:** grep-verify zero `checkins`/`venue` references in `server/src` (outside
  migrations), run full `server` + `client` + `shared` test suites.
