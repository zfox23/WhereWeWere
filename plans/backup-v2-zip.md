# Backup v2: per-plugin JSON files in a ZIP bundle

## Motivation

Backup v1 serializes every plugin's rows — including full Tracks geometry and
per-point series — into a single `data.plugins` object in one JSON document.
For long-running deployments this exceeds 100 MB, which makes the download
and the in-memory `multer` + `JSON.parse` restore path painful.

v2 changes:

1. The backup is a **ZIP** (downloaded as `wherewewere-backup-v2-<date>.zip`).
2. Each plugin's data lives in its **own JSON file** (`plugins/<id>.json`).
3. **Tracks no longer inline geometry/points.** The ZIP ships the *original
   uploaded GPX/TCX file* verbatim plus a small **diff** (trim range) and the
   editable row fields (name, activity_type, timezone, ...). Restore re-parses
   the original, applies the trim, and recomputes all derived stats.
4. The metadata version is bumped to `schemaVersion: 2` in the manifest.
   v1 single-JSON uploads keep working for restore.

## ZIP layout

```
wherewewere-backup-v2-YYYY-MM-DD.zip
├── backup.json                    # manifest: { format, schemaVersion: 2,
│                                   #   exportedAt, user, settings }
├── plugins/
│   ├── location.json              # PluginBackupEntry, unchanged v1 shape
│   ├── media.json
│   ├── sleep.json
│   ├── mood.json
│   └── tracks.json                # rows without geometry/points, plus:
│   │                              #   file:  "files/<trackId>.gpx" | ".tcx"
│   │                              #   trim:  { start_index, end_index } | null
│   └── tracks/
│       └── files/<trackId>.gpx    # the ORIGINAL uploaded file, verbatim
```

### `backup.json` manifest

```json
{
  "format": "wherewewere-backup",
  "schemaVersion": 2,
  "exportedAt": "2026-09-23T02:00:00.000Z",
  "user": { "id": "...", "username": "...", "email": "...",
            "display_name": "...", "created_at": "...", "updated_at": "..." },
  "settings": { "dawarich_url": null, "...": "..." }
}
```

### `plugins/<id>.json`

Identical shape to the v1 `data.plugins[<id>]` entry:

```json
{
  "checkins": [...],
  "extra": { "<table>": [ ...rows ] },
  "settings": { "<key>": <value> }
}
```

### `plugins/tracks.json` rows (v2 shape)

```json
{
  "id": "…", "user_id": "…",
  "name": "Morning Ride", "activity_type": "Cycling", "timezone": "America/Los_Angeles",
  "file_hash": "sha256…",
  "started_at": "…", "ended_at": "…", "created_at": "…", "updated_at": "…",
  "file": "files/<trackId>.gpx",
  "trim": { "start_index": 12, "end_index": 3480 },
  "distance_m": 8123, "elapsed_time_s": 3100, "moving_time_s": 3050,
  "elevation_gain_m": 96, "avg_speed_mps": 2.66, "max_speed_mps": 7.1,
  "avg_hr": 142, "max_hr": 171, "point_count": 3469
}
```

- `file`/`trim` are present when the original file is on disk at export time.
  `trim` is `null` when the stored points are the full file (no trimming).
- **Fallback:** if the original file is missing on disk (or the row has no
  per-point series to match), the row falls back to the v1 inline shape
  (`geometry` + `points` arrays, no `file`/`trim`).

## Trim diff derivation (export)

The user can only ever **trim** a track (drop a prefix/suffix of points) and
edit `name`/`activity_type`. So the stored `(geometry, points)` series is
always a contiguous subsequence of the original file's parsed points.

Export algorithm per track:

1. Read + parse the stored original (`parseTrackFile`) → `originalPoints`.
2. Take the stored `points` series (`t`, `ele`, `hr` per index).
3. Find the first index `s` in `originalPoints` whose `(t, ele, hr)` triple
   equals the stored first point. Verify the stored series matches
   `originalPoints[s..s+len-1]` exactly (with a coordinate match as a
   tie-breaker).
4. If matched: `trim = { start_index: s, end_index: s + len - 1 }`
   (`null` when `s === 0 && end === original.length - 1`).
5. If not matched (file was manually swapped, or parse produced a different
   point count): fall back to inline geometry + points.

## Restore (import)

`POST /api/v1/backup/import` accepts both `.json` (v1) and `.zip` (v2):

1. **ZIP path** — multer memory buffer → temp dir → `unzipper` extracts with
   path-traversal validation (no `..`, no absolute paths). Read
   `backup.json` (validate `format` + `schemaVersion <= 2`), then read each
   `plugins/<id>.json` into the same `pluginsPayload` map the v1 route used.
2. **Shared restore** — same transaction as v1: user display_name, user
   settings (+ legacy settings keys), `restoreLegacyPluginData` (only when the
   backup has no plugins payload), then `importPluginData` with
   `filesDir = <extractedDir>/plugins/<id>` threaded into
   `PluginHookContext`.
3. **Tracks restore (v2 row with `file`)**:
   - Read the original file from `filesDir`, `parseTrackFile`.
   - Apply `trim` range (full range when null).
   - `computeTrackStats` on the trimmed points → all derived stats, geometry,
     and the `points` series are **recomputed**, not trusted from the backup.
   - Row fields (`name`, `activity_type`, `timezone`, `file_hash`,
     `created_at`, `updated_at`) come from the backup row.
   - `INSERT ... ON CONFLICT (id) DO NOTHING`; on a `file_hash` 23505 conflict
     the track is skipped (already present — same semantics as duplicate
     upload).
   - After `COMMIT`, copy the original file back to
     `<dataDir>/<uid>/uploads/gps_tracks/<trackId>.<ext>`.
   - A row whose `file` is referenced but missing from the ZIP is skipped and
     reported in `errors`.
4. **v1 tracks rows** (inline `geometry` + `points`, no `file`) still restore
   via the existing `insertTrackRow` path — no file involved.

## Backward/forward compatibility

- Restore accepts v1 single-JSON files unchanged (schemaVersion 1).
- The manifest `schemaVersion` is the *metadata version*; the existing
  migrator hook point in `ensureV1Backup` is kept (v2 manifests bypass it,
  v1 manifests still go through it).
- Newer schemaVersions still fail with a clear error.

## Files touched

| File | Change |
| --- | --- |
| `shared/src/plugin.ts` | `PluginHookContext.filesDir?`; new optional `backupFiles` hook |
| `server/src/plugins/backup.ts` | `exportPluginData`/`importPluginData` thread `filesDir`; collect `backupFiles` |
| `server/src/routes/backup.ts` | v2 manifest, ZIP export via `archiver`, ZIP import via `unzipper`, schema bump |
| `server/src/services/backupArchive.ts` | (new) ZIP build/extract helpers shared by the route |
| `plugins/tracks/server.ts` | `backupExport` diff + `backupFiles`; `backupImport` file-based restore |
| `client/src/pages/settings/BackupRestoreSection.tsx` | accept `.zip`, updated copy |
| `server/package.json` | add `archiver` |
| tests | ZIP round-trip, trim diff, v1 regression |
