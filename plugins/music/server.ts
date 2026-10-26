/**
 * Music plugin — server half.
 *
 * CUSTOM storage: `music_scrobbles` holds every play; `music_sessions` groups
 * them into listening sessions, which are what the Home timeline shows (one
 * item per session keeps a day of listening from drowning everything else).
 *
 * Scrobbles arrive from multi-scrobbler (see services/scrobblerApi.ts) or a
 * file import.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import type { CheckinTypeServerPlugin, PluginTimelineContext } from 'wwp-shared';
import { isValidTimeZone } from 'wwp-shared';
import { query } from '../../server/src/db';
import { timelineColumnList } from '../../server/src/plugins/timeline';
import { timelineWhereConditions } from '../../server/src/plugins/sql';
import { createImportUpload, removeImportFile } from '../../server/src/plugins/uploads';
import { pluginTimestampUnion } from '../../server/src/plugins/registry';
import { parseCheckinIdList, isUuid } from '../../server/src/services/batching';
import { clampInt } from '../../server/src/services/queryParams';
import { normalizeCompanions } from '../../server/src/services/companions';
import { tokensMatch } from '../../server/src/services/tokens';
import { DEFAULT_USER_ID as USER_ID } from '../../server/src/constants';
import {
  API_MOUNT,
  SERVER_INFO,
  failure,
  newScrobbleSuccess,
  parseDateRange,
  parseNewScrobble,
  scrobbleListResponse,
} from './services/scrobblerApi';
import { suggest } from './services/suggest';
import { parseScrobbleExport } from './services/importParser';
import { parseLastfmCsv } from './services/lastfmCsv';
import {
  InvalidNameError,
  NameTakenError,
  addItem,
  deleteRankSession,
  getRankSession,
  saveRankSession,
  validateRankSession,
  createList,
  createListWithItems,
  MAX_BULK_ITEMS,
  deleteList,
  exportLists,
  getListItems,
  getLists,
  importLists,
  removeItem,
  renameList,
  setRanks,
} from './services/lists';
import {
  albumLookupEnabled,
  cancelBackfill,
  exportAlbums,
  importAlbums,
  listThumbnailFiles,
  getAlbumArtFile,
  getAlbumCounts,
  getAlbumView,
  getBackfillStatus,
  startBackfill,
} from './services/albums';
import { DEFAULT_MIN_SESSION_TRACKS, DEFAULT_SESSION_GAP_MINUTES, PLUGIN_ID } from './services/constants';
import {
  getCounts,
  getListeningBefore,
  getReflectionTracks,
  getLibrary,
  getMusicSettings,
  getSessionTracks,
  getTotals,
  deleteManualScrobble,
  insertManualScrobble,
  insertScrobble,
  insertScrobblesBulk,
  listScrobbles,
  recomputeTimezones,
  regenerateScrobblerKey,
  updateMusicSettings,
  type LibraryView,
} from './services/scrobbles';

const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;
const ALL_PER_PAGE = 1_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateParam(raw: unknown): string | null {
  return typeof raw === 'string' && DATE_RE.test(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Scrobbler protocol: mounted at the server root, outside API_ACCESS_TOKEN
// ---------------------------------------------------------------------------

const scrobblerRouter = Router();

async function keyIsValid(presented: unknown): Promise<boolean> {
  if (typeof presented !== 'string' || !presented) return false;
  const { scrobbler_key } = await getMusicSettings(USER_ID);
  return tokensMatch(presented, scrobbler_key);
}

scrobblerRouter.get('/serverinfo', (_req: Request, res: Response) => {
  res.json(SERVER_INFO);
});

scrobblerRouter.get('/test', async (req: Request, res: Response) => {
  try {
    if (!(await keyIsValid(req.query.key))) {
      return res.status(403).json(failure('authentication_fail', 'Invalid API key'));
    }
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Scrobbler key test failed:', err);
    res.status(500).json(failure('server_error', 'Internal error'));
  }
});

scrobblerRouter.post('/newscrobble', async (req: Request, res: Response) => {
  try {
    if (!(await keyIsValid(req.body?.key ?? req.query.key))) {
      return res.status(403).json(failure('authentication_fail', 'Invalid API key'));
    }
    const parsed = parseNewScrobble(req.body);
    if (!parsed.ok) {
      return res.status(400).json(failure('invalid_scrobble', parsed.reason));
    }
    await insertScrobble(USER_ID, parsed.scrobble);
    // A repeat of a stored play is still a success: the client's goal (the
    // play exists here) is met, and a failure would only make it retry.
    res.json(newScrobbleSuccess(parsed.scrobble));
  } catch (err) {
    console.error('Error storing scrobble:', err);
    res.status(500).json(failure('server_error', 'Failed to store scrobble'));
  }
});

// Unauthenticated by necessity: multi-scrobbler reads history (to skip plays
// it has already sent) without sending the key.
scrobblerRouter.get('/scrobbles', async (req: Request, res: Response) => {
  try {
    // Like Maloja, no `perpage` means everything in range on one page.
    // Multi-scrobbler's history fetch sends none and can't advance a page
    // cursor, so a default page size would make it fail on any busy day.
    const perPage = req.query.perpage === undefined
      ? ALL_PER_PAGE
      : clampInt(req.query.perpage, { fallback: 100, min: 1, max: 1000 });
    const page = clampInt(req.query.page, { fallback: 0, min: 0, max: 10_000_000 });

    let from: Date | null = null;
    let until: Date | null = null;
    const whole = req.query.in !== undefined ? parseDateRange(req.query.in) : null;
    if (req.query.in !== undefined && !whole) {
      return res.status(400).json(failure('invalid_date', 'Unrecognised date'));
    }
    if (whole) {
      from = whole.from;
      until = whole.until;
    }
    if (req.query.from !== undefined) {
      const r = parseDateRange(req.query.from);
      if (!r) return res.status(400).json(failure('invalid_date', 'Unrecognised date'));
      from = r.from;
    }
    if (req.query.until !== undefined) {
      const r = parseDateRange(req.query.until);
      if (!r) return res.status(400).json(failure('invalid_date', 'Unrecognised date'));
      until = r.until;
    }

    // Dates carry no zone and the caller's local day isn't known (multi-scrobbler
    // sends days in its own TZ, so 10:46 PM Eastern is the 25th there but the
    // 26th in UTC). Widen by the largest UTC offset each way: extra plays are
    // harmless to a caller deduplicating by time, missing ones are not.
    if (from) from = new Date(from.getTime() - MAX_UTC_OFFSET_MS);
    if (until) until = new Date(until.getTime() + MAX_UTC_OFFSET_MS);
    const { rows, hasMore } = await listScrobbles(USER_ID, { from, until, page, perPage });
    const echoed = new URLSearchParams();
    for (const key of ['in', 'from', 'until'] as const) {
      const v = req.query[key];
      if (typeof v === 'string') echoed.set(key, v);
    }
    res.json(scrobbleListResponse(rows, page, perPage, hasMore, echoed));
  } catch (err) {
    console.error('Error listing scrobbles:', err);
    res.status(500).json(failure('server_error', 'Failed to list scrobbles'));
  }
});

// ---------------------------------------------------------------------------
// Plugin API: /api/v1/music
// ---------------------------------------------------------------------------

const musicRouter = Router();

musicRouter.get('/settings', async (_req: Request, res: Response) => {
  try {
    const [settings, counts] = await Promise.all([getMusicSettings(USER_ID), getCounts(USER_ID)]);
    res.json({ ...settings, ...counts, scrobbler_path: API_MOUNT });
  } catch (err) {
    console.error('Error loading music settings:', err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

musicRouter.put('/settings', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const updates: Parameters<typeof updateMusicSettings>[1] = {};
    if (b.session_gap_minutes !== undefined) {
      const n = Number(b.session_gap_minutes);
      if (!Number.isInteger(n) || n < 1 || n > 1440) {
        return res.status(400).json({ error: 'session_gap_minutes must be 1-1440' });
      }
      updates.session_gap_minutes = n;
    }
    if (b.min_session_tracks !== undefined) {
      const n = Number(b.min_session_tracks);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        return res.status(400).json({ error: 'min_session_tracks must be 1-1000' });
      }
      updates.min_session_tracks = n;
    }
    if (b.timezone !== undefined) {
      if (typeof b.timezone !== 'string' || !isValidTimeZone(b.timezone)) {
        return res.status(400).json({ error: 'Invalid timezone' });
      }
      updates.timezone = b.timezone;
    }
    res.json(await updateMusicSettings(USER_ID, updates));
  } catch (err) {
    console.error('Error saving music settings:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// POST /timezones/refresh - re-assign every play's timezone from the user's
// current check-ins (after adding or fixing check-ins, or an import).
musicRouter.post('/timezones/refresh', async (_req: Request, res: Response) => {
  try {
    res.json({ updated: await recomputeTimezones(USER_ID) });
  } catch (err) {
    console.error('Error refreshing scrobble timezones:', err);
    res.status(500).json({ error: 'Failed to refresh timezones' });
  }
});

musicRouter.post('/settings/regenerate-key', async (_req: Request, res: Response) => {
  try {
    res.json({ scrobbler_key: await regenerateScrobblerKey(USER_ID) });
  } catch (err) {
    console.error('Error regenerating scrobbler key:', err);
    res.status(500).json({ error: 'Failed to regenerate key' });
  }
});

// GET /stats?from&to - totals plus top songs/artists/albums for the period
musicRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const from = dateParam(req.query.from);
    const to = dateParam(req.query.to);
    const limit = clampInt(req.query.limit, { fallback: 10, min: 1, max: 25 });
    const [totals, top_songs, top_artists, top_albums] = await Promise.all([
      getTotals(USER_ID, from, to),
      getLibrary(USER_ID, 'songs', from, to, limit),
      getLibrary(USER_ID, 'artists', from, to, limit),
      getLibrary(USER_ID, 'albums', from, to, limit),
    ]);
    res.json({ totals, top_songs, top_artists, top_albums });
  } catch (err) {
    console.error('Error loading music stats:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /library?view=songs|artists|albums&from&to&limit
musicRouter.get('/library', async (req: Request, res: Response) => {
  try {
    const view = (['songs', 'artists', 'albums'] as const).includes(req.query.view as LibraryView)
      ? (req.query.view as LibraryView)
      : 'songs';
    const from = dateParam(req.query.from);
    const to = dateParam(req.query.to);
    const limit = clampInt(req.query.limit, { fallback: 1000, min: 1, max: 1000 });
    res.json(await getLibrary(USER_ID, view, from, to, limit));
  } catch (err) {
    console.error('Error loading music library:', err);
    res.status(500).json({ error: 'Failed to load library' });
  }
});

// GET /reflect?date=YYYY-MM-DD - top tracks on that month and day in earlier years
musicRouter.get('/reflect', async (req: Request, res: Response) => {
  try {
    const date = dateParam(req.query.date);
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    res.json(await getReflectionTracks(USER_ID, date));
  } catch (err) {
    console.error('Error loading music reflection:', err);
    res.status(500).json({ error: 'Failed to load music reflection' });
  }
});

// ---- Album artwork and release info -------------------------------------

musicRouter.get('/albums/status', async (_req: Request, res: Response) => {
  try {
    res.json({ enabled: albumLookupEnabled(), albums: await getAlbumCounts(USER_ID), job: getBackfillStatus() });
  } catch (err) {
    console.error('Error loading album status:', err);
    res.status(500).json({ error: 'Failed to load album status' });
  }
});

musicRouter.post('/albums/backfill', async (req: Request, res: Response) => {
  try {
    if (!albumLookupEnabled()) return res.status(503).json({ error: 'Album lookup is disabled' });
    if (getBackfillStatus().state === 'running') return res.status(409).json({ error: 'A lookup is already running' });
    res.status(202).json(await startBackfill(USER_ID, { retryMissing: req.body?.retry_missing === true }));
  } catch (err) {
    console.error('Error starting album lookup:', err);
    res.status(500).json({ error: 'Failed to start album lookup' });
  }
});

musicRouter.post('/albums/backfill/cancel', (_req: Request, res: Response) => {
  cancelBackfill();
  res.json(getBackfillStatus());
});

// ?ref=<album_ref from a row> or ?art_id=<cover id>
musicRouter.get('/album-view', async (req: Request, res: Response) => {
  try {
    const ref = typeof req.query.ref === 'string' && req.query.ref.length <= 2000 ? req.query.ref : undefined;
    const artId = typeof req.query.art_id === 'string' ? req.query.art_id : undefined;
    if (artId !== undefined && !isUuid(artId)) return res.status(400).json({ error: 'Invalid cover id' });
    if (ref === undefined && artId === undefined) return res.status(400).json({ error: 'ref or art_id is required' });
    const album = await getAlbumView(USER_ID, { ref, artId });
    if (!album) return res.status(404).json({ error: 'Album not found' });
    res.json(album);
  } catch (err) {
    console.error('Error loading album:', err);
    res.status(500).json({ error: 'Failed to load album' });
  }
});

// Ids never change what they point at, so the browser may keep covers a long
// time; one page renders the same cover many times.
musicRouter.get('/albums/:id/art', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).end();
    const file = await getAlbumArtFile(USER_ID, id, req.query.size === 'large' ? 'large' : 'thumb');
    if (!file) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.type('image/jpeg').sendFile(file);
  } catch (err) {
    console.error('Error serving album art:', err);
    res.status(500).end();
  }
});

// ---- Lists of songs and albums -------------------------------------------

function listError(res: Response, err: unknown, what: string) {
  if (err instanceof InvalidNameError) return res.status(400).json({ error: err.message });
  if (err instanceof NameTakenError) return res.status(409).json({ error: err.message });
  console.error(`Error ${what}:`, err);
  return res.status(500).json({ error: `Failed ${what}` });
}

const IDENT_MAX = 2000;
const ident = (v: unknown): string | null => (typeof v === 'string' && v.length <= IDENT_MAX ? v : null);

musicRouter.get('/lists', async (_req: Request, res: Response) => {
  try {
    res.json(await getLists(USER_ID));
  } catch (err) {
    listError(res, err, 'loading lists');
  }
});

musicRouter.post('/lists', async (req: Request, res: Response) => {
  try {
    res.status(201).json(await createList(USER_ID, req.body?.name));
  } catch (err) {
    listError(res, err, 'creating the list');
  }
});

// Make a list from many songs/albums at once, ranked in the order given.
// Body: { name, items: [{ kind: 'album', album_ref } | { kind: 'song', song_key, album_ref? }] }
musicRouter.post('/lists/from-items', async (req: Request, res: Response) => {
  try {
    const raw: unknown = req.body?.items;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BULK_ITEMS) {
      return res.status(400).json({ error: `Send 1 to ${MAX_BULK_ITEMS} items` });
    }
    const items = [];
    for (const i of raw as Record<string, unknown>[]) {
      if (i?.kind === 'album' && ident(i.album_ref) !== null) {
        items.push({ kind: 'album' as const, album_ref: i.album_ref as string });
      } else if (i?.kind === 'song' && ident(i.song_key)) {
        items.push({ kind: 'song' as const, song_key: i.song_key as string, album_ref: ident(i.album_ref) });
      } else {
        return res.status(400).json({ error: 'Each item needs a kind and its album_ref or song_key' });
      }
    }
    const created = await createListWithItems(USER_ID, req.body?.name, items);
    if (!created) return res.status(404).json({ error: 'None of those songs or albums were found' });
    res.status(201).json(created);
  } catch (err) {
    listError(res, err, 'creating the list');
  }
});

musicRouter.put('/lists/:id', async (req: Request, res: Response) => {
  try {
    if (!isUuid(String(req.params.id))) return res.status(400).json({ error: 'Invalid list id' });
    const list = await renameList(USER_ID, String(req.params.id), req.body?.name);
    if (!list) return res.status(404).json({ error: 'List not found' });
    res.json(list);
  } catch (err) {
    listError(res, err, 'renaming the list');
  }
});

musicRouter.delete('/lists/:id', async (req: Request, res: Response) => {
  try {
    if (!isUuid(String(req.params.id))) return res.status(400).json({ error: 'Invalid list id' });
    if (!(await deleteList(USER_ID, String(req.params.id)))) return res.status(404).json({ error: 'List not found' });
    res.json({ id: req.params.id });
  } catch (err) {
    listError(res, err, 'deleting the list');
  }
});

// Body: { kind: 'album', album_ref } or { kind: 'song', song_key, album_ref? },
// the opaque identities the server returned on rows.
musicRouter.post('/lists/:id/items', async (req: Request, res: Response) => {
  try {
    const listId = String(req.params.id);
    if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
    const b = req.body ?? {};
    let result = null;
    if (b.kind === 'album' && ident(b.album_ref) !== null) {
      result = await addItem(USER_ID, listId, { kind: 'album', album_ref: b.album_ref });
    } else if (b.kind === 'song' && ident(b.song_key)) {
      result = await addItem(USER_ID, listId, { kind: 'song', song_key: b.song_key, album_ref: ident(b.album_ref) });
    } else {
      return res.status(400).json({ error: 'Say which song or album to add' });
    }
    if (!result) return res.status(404).json({ error: 'List or music not found' });
    res.status(result.added ? 201 : 200).json(result);
  } catch (err) {
    listError(res, err, 'adding to the list');
  }
});

musicRouter.delete('/lists/:id/items/:itemId', async (req: Request, res: Response) => {
  try {
    const listId = String(req.params.id);
    const itemId = String(req.params.itemId);
    if (!isUuid(listId) || !isUuid(itemId)) return res.status(400).json({ error: 'Invalid id' });
    if (!(await removeItem(USER_ID, listId, itemId))) return res.status(404).json({ error: 'Item not found' });
    res.json({ id: itemId });
  } catch (err) {
    listError(res, err, 'removing from the list');
  }
});

// Drag-to-rank: the item ids in their new rank order; everyone else on the list becomes unranked.
musicRouter.put('/lists/:id/ranks', async (req: Request, res: Response) => {
  try {
    const listId = String(req.params.id);
    const ids: unknown = req.body?.ranked_ids;
    if (!isUuid(listId) || !Array.isArray(ids) || !ids.every((i) => typeof i === 'string' && isUuid(i))) {
      return res.status(400).json({ error: 'ranked_ids must be a list of item ids' });
    }
    if (!(await setRanks(USER_ID, listId, ids as string[]))) return res.status(404).json({ error: 'List not found' });
    res.json({ ranked_ids: ids });
  } catch (err) {
    listError(res, err, 'ranking the list');
  }
});

// A paused "rank by comparing" session, so it can be resumed later.
musicRouter.get('/lists/:id/rank-session', async (req: Request, res: Response) => {
  try {
    const listId = String(req.params.id);
    if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
    const session = await getRankSession(USER_ID, listId);
    if (!session) return res.status(404).json({ error: 'No paused session' });
    res.json(session);
  } catch (err) {
    listError(res, err, 'loading the ranking session');
  }
});

musicRouter.put('/lists/:id/rank-session', async (req: Request, res: Response) => {
  try {
    const listId = String(req.params.id);
    if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
    const state = validateRankSession(req.body?.state);
    if (!state) return res.status(400).json({ error: 'Not a ranking session' });
    if (!(await saveRankSession(USER_ID, listId, state))) return res.status(404).json({ error: 'List not found' });
    res.json({ saved: true });
  } catch (err) {
    listError(res, err, 'saving the ranking session');
  }
});

musicRouter.delete('/lists/:id/rank-session', async (req: Request, res: Response) => {
  try {
    const listId = String(req.params.id);
    if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
    await deleteRankSession(USER_ID, listId);
    res.json({ deleted: true });
  } catch (err) {
    listError(res, err, 'discarding the ranking session');
  }
});

// One list's items with all-time plays of each.
musicRouter.get('/lists/:id/items', async (req: Request, res: Response) => {
  try {
    const listId = String(req.params.id);
    if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
    const items = await getListItems(USER_ID, listId);
    if (!items) return res.status(404).json({ error: 'List not found' });
    res.json(items);
  } catch (err) {
    listError(res, err, 'loading the list');
  }
});

// ---- Hand-entered plays ---------------------------------------------------

// GET /suggest?artist=&title= - autocomplete: your own songs first, then the catalog.
musicRouter.get('/suggest', async (req: Request, res: Response) => {
  try {
    const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '');
    res.json(await suggest(USER_ID, { artist: text(req.query.artist), title: text(req.query.title) }));
  } catch (err) {
    console.error('Error suggesting songs:', err);
    res.status(500).json({ error: 'Failed to look up songs' });
  }
});

const clean = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// POST /scrobbles - write down a song you heard. A play of the same song around
// then already on file is reported (409) unless `force` is sent.
musicRouter.post('/scrobbles', async (req: Request, res: Response) => {
  try {
    const b = req.body ?? {};
    const title = clean(b.title, 300);
    const artists = (Array.isArray(b.artists) ? b.artists : []).flatMap((a: unknown) => (clean(a, 200) ? [clean(a, 200) as string] : [])).slice(0, 20);
    const playedAt = new Date(b.played_at);
    if (!title || artists.length === 0) return res.status(400).json({ error: 'A song needs a title and an artist' });
    if (Number.isNaN(playedAt.getTime()) || playedAt.getTime() > Date.now() + 24 * 3600_000) {
      return res.status(400).json({ error: 'Give the time it was played (not more than a day ahead)' });
    }
    const length = Number(b.track_length);
    const lat = b.latitude === null || b.latitude === undefined ? null : Number(b.latitude);
    const lng = b.longitude === null || b.longitude === undefined ? null : Number(b.longitude);
    const located = lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && Number.isFinite(lat) && Number.isFinite(lng);
    const outcome = await insertManualScrobble(
      USER_ID,
      {
        playedAt,
        title,
        artists,
        album: clean(b.album, 300),
        albumArtists: (Array.isArray(b.album_artists) ? b.album_artists : []).flatMap((a: unknown) => (clean(a, 200) ? [clean(a, 200) as string] : [])).slice(0, 20),
        trackLength: Number.isFinite(length) && length > 0 && length <= 86_400 ? Math.round(length) : null,
        timezone: typeof b.timezone === 'string' && isValidTimeZone(b.timezone) ? b.timezone : null,
        note: clean(b.note, 2000),
        latitude: located ? lat : null,
        longitude: located ? lng : null,
        locationAccuracy: located && Number.isInteger(b.location_accuracy) && b.location_accuracy >= 0 ? b.location_accuracy : null,
      },
      { force: b.force === true, companions: normalizeCompanions(b.companions).slice(0, 20) },
    );
    if (outcome.duplicate) {
      return res.status(409).json({ error: 'You already have this song around that time', duplicate: outcome.duplicate });
    }
    if (!outcome.inserted) return res.status(409).json({ error: 'That play is already recorded' });
    res.status(201).json({ id: outcome.id, session_id: outcome.sessionId });
  } catch (err) {
    console.error('Error saving manual scrobble:', err);
    res.status(500).json({ error: 'Failed to save the song' });
  }
});

// DELETE /scrobbles/:id - take back a hand-entered play (scrobbler plays stay).
musicRouter.delete('/scrobbles/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid id' });
    if (!(await deleteManualScrobble(USER_ID, id))) return res.status(404).json({ error: 'No hand-entered song with that id' });
    res.json({ id });
  } catch (err) {
    console.error('Error deleting manual scrobble:', err);
    res.status(500).json({ error: 'Failed to delete the song' });
  }
});

// GET /around?checkin_ids=a,b - what was playing at the end of each check-in
// (see getListeningBefore). Check-ins with nothing to show are omitted.
musicRouter.get('/around', async (req: Request, res: Response) => {
  try {
    const checkinIds = parseCheckinIdList(req.query.checkin_ids);
    if (checkinIds.length === 0) return res.json({});
    // Anchor times come from each check-in type's own plugin hook.
    const anchors = await query(pluginTimestampUnion('         '), [checkinIds]);
    const settings = await getMusicSettings(USER_ID);
    const found = await getListeningBefore(
      USER_ID,
      anchors.rows.map((r: { id: string; checked_in_at: string }) => ({ id: r.id, time: new Date(r.checked_in_at) })),
      settings.session_gap_minutes,
      settings.min_session_tracks,
    );
    res.json(Object.fromEntries(found));
  } catch (err) {
    console.error('Error loading listening before check-ins:', err);
    res.status(500).json({ error: 'Failed to load listening' });
  }
});

musicRouter.get('/sessions/:id/tracks', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid session id' });
    res.json(await getSessionTracks(USER_ID, id));
  } catch (err) {
    console.error('Error loading session tracks:', err);
    res.status(500).json({ error: 'Failed to load tracks' });
  }
});

const importUpload = createImportUpload({
  fileFilter: (file) =>
    /\.(json|csv)$/i.test(file.originalname) ? null : 'Only .json or .csv scrobble exports are allowed',
  fileSize: 200 * 1024 * 1024,
});

/** Shared handler: read the uploaded file with `parse`, insert, report counts. */
function importHandler(parse: (text: string) => ReturnType<typeof parseScrobbleExport>, badInput: string[]) {
  return async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const parsed = parse(fs.readFileSync(file.path, 'utf8'));
      const inserted = await insertScrobblesBulk(USER_ID, parsed.scrobbles);
      res.json({
        parsed: parsed.scrobbles.length,
        inserted,
        duplicates: parsed.scrobbles.length - inserted,
        skipped: parsed.skipped,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      if (badInput.includes(message)) return res.status(400).json({ error: message });
      console.error('Error importing scrobbles:', err);
      res.status(500).json({ error: 'Failed to import scrobbles' });
    } finally {
      removeImportFile(file.path);
    }
  };
}

// POST /import/scrobbles - Maloja-format JSON export
musicRouter.post(
  '/import/scrobbles',
  importUpload.single('file'),
  importHandler(parseScrobbleExport, ['File is not valid JSON', 'No scrobbles found in file']),
);

// POST /import/lastfm - Last.fm CSV history export
musicRouter.post(
  '/import/lastfm',
  importUpload.single('file'),
  importHandler(parseLastfmCsv, ['Not a Last.fm CSV export', 'No scrobbles found in file']),
);

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const MIN_TRACKS_SQL = `COALESCE(
  (SELECT (ps.value #>> '{}')::int FROM plugin_settings ps
    WHERE ps.user_id = ms.user_id AND ps.plugin_id = '${PLUGIN_ID}' AND ps.key = 'min_session_tracks'),
  ${DEFAULT_MIN_SESSION_TRACKS})`;

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  api: [
    { mount: '/music', router: musicRouter },
  ],
  rootApi: { mount: API_MOUNT, router: scrobblerRouter },

  settingsKeys: [
    { name: 'scrobbler_key', type: 'string', label: 'Scrobbler key' },
    { name: 'session_gap_minutes', type: 'number', label: 'Session gap (minutes)', default: DEFAULT_SESSION_GAP_MINUTES },
    { name: 'min_session_tracks', type: 'number', label: 'Minimum tracks per timeline session', default: DEFAULT_MIN_SESSION_TRACKS },
    { name: 'timezone', type: 'string', label: 'Fallback timezone for plays before your first check-in', default: 'UTC' },
  ],

  buildTimelineSelect: () => ({
    sql: `
      SELECT ${timelineColumnList({
        type: `'music'`,
        id: 'ms.id',
        user_id: 'ms.user_id',
        checked_in_at: 'ms.ended_at',
        created_at: 'ms.created_at',
        data: `json_build_object(
          'started_at', ms.started_at,
          'ended_at', ms.ended_at,
          'track_count', ms.track_count,
          'listened_seconds', ms.listened_seconds,
          'top_artists', ms.top_artists
        )::jsonb`,
        timezone: 'ms.timezone',
        // Who was there for any hand-entered play in the session.
        companions: `(SELECT COALESCE(json_agg(DISTINCT c.name), '[]'::json)
                      FROM music_scrobbles s JOIN companions c ON c.checkin_type = '${PLUGIN_ID}' AND c.checkin_id = s.id
                      WHERE s.session_id = ms.id)`,
      })}
      FROM music_sessions ms
    `,
  }),

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conds = timelineWhereConditions(ctx, {
      alias: 'ms',
      timestampColumn: 'ended_at',
      timezoneColumn: 'timezone',
      search: (c, q) => c.push(`ms.search_text ILIKE '%' || ? || '%'`, q),
    });
    // Short sessions stay in the data but out of the feed.
    // A session holding a play the user wrote down by hand is always shown.
    conds.push(`(ms.track_count >= ${MIN_TRACKS_SQL} OR ms.has_manual)`);
    return conds.build();
  },

  // The payload carries the settings sessions are built with: the framework
  // restores plugin_settings only after this hook runs.
  backupExport: async ({ user_id }) => {
    const [settings, result] = await Promise.all([
      getMusicSettings(user_id),
      query(
        `SELECT id, played_at, title, artists, album, album_artists, track_length, listened_for, source, timezone,
                note, latitude, longitude, location_accuracy
         FROM music_scrobbles WHERE user_id = $1 ORDER BY played_at ASC`,
        [user_id],
      ),
    ]);
    return {
      session_gap_minutes: settings.session_gap_minutes,
      timezone: settings.timezone,
      scrobbles: result.rows,
      // Album matches, release info and tracklists; thumbnails travel as files.
      albums: await exportAlbums(user_id),
      // The user's own curation, in list order.
      lists: await exportLists(user_id),
    };
  },

  backupFiles: async ({ user_id }) => ({ files: await listThumbnailFiles(user_id) }),

  backupImport: async ({ user_id, client, filesDir }, payload) => {
    const body = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as {
      session_gap_minutes?: unknown;
      timezone?: unknown;
      scrobbles?: unknown;
      albums?: unknown;
      lists?: unknown;
    };
    const rows = Array.isArray(body.scrobbles) ? body.scrobbles : Array.isArray(payload) ? payload : [];
    const scrobbles = rows.flatMap((r) => {
      const title = typeof r?.title === 'string' ? r.title : null;
      const playedAt = new Date(r?.played_at);
      if (!title || !Array.isArray(r.artists) || Number.isNaN(playedAt.getTime())) return [];
      return [{
        playedAt,
        title,
        artists: r.artists as string[],
        album: r.album ?? null,
        albumArtists: Array.isArray(r.album_artists) ? (r.album_artists as string[]) : [],
        trackLength: r.track_length ?? null,
        listenedFor: r.listened_for ?? null,
        source: r.source ?? null,
        timezone: typeof r.timezone === 'string' ? r.timezone : null,
        // Kept so a hand entry's companions (stored by scrobble id) stay attached.
        id: typeof r.id === 'string' && /^[0-9a-f-]{36}$/i.test(r.id) ? r.id : null,
        note: typeof r.note === 'string' ? r.note : null,
        latitude: Number.isFinite(Number(r.latitude)) && r.latitude !== null ? Number(r.latitude) : null,
        longitude: Number.isFinite(Number(r.longitude)) && r.longitude !== null ? Number(r.longitude) : null,
        locationAccuracy: Number.isInteger(r.location_accuracy) ? r.location_accuracy : null,
      }];
    });
    const gap = Number(body.session_gap_minutes);
    const inserted = await insertScrobblesBulk(user_id, scrobbles, {
      db: client,
      sessionGapMinutes: Number.isInteger(gap) && gap >= 1 ? gap : undefined,
      fallbackTimezone: typeof body.timezone === 'string' && isValidTimeZone(body.timezone) ? body.timezone : undefined,
    });
    // A cache: it doesn't count toward what was restored.
    await importAlbums(client ?? { query }, user_id, body.albums, filesDir);
    // Lists merge by name, items by identity; they don't count toward the scrobbles restored.
    await importLists(client ?? { query }, user_id, body.lists);
    return inserted;
  },

  deleteUserData: async ({ user_id, client: txClient }) => {
    const run = (sql: string, values: unknown[]) =>
      txClient ? txClient.query(sql, values) : query(sql, values);
    const result = await run('DELETE FROM music_scrobbles WHERE user_id = $1 RETURNING id', [user_id]);
    await run('DELETE FROM music_sessions WHERE user_id = $1', [user_id]);
    // A rebuildable cache; orphaned image files are collected on the next lookup.
    await run('DELETE FROM music_albums WHERE user_id = $1', [user_id]);
    await run(`DELETE FROM companions WHERE checkin_type = '${PLUGIN_ID}'`, []);
    // Lists are the user's own curation, so Start Over removes them too (items cascade).
    await run('DELETE FROM music_lists WHERE user_id = $1', [user_id]);
    return result.rowCount ?? 0;
  },

  // Hand-entered plays carry companions, which the Companions tab resolves to a time.
  resolveTimestamps: () => ({
    sql: `SELECT id, played_at AS checked_in_at FROM music_scrobbles WHERE id = ANY($1::uuid[])`,
  }),

  earliestDate: () => ({
    sql: `SELECT MIN((played_at AT TIME ZONE timezone)::date)::text AS date
          FROM music_scrobbles WHERE user_id = $1`,
  }),
};
