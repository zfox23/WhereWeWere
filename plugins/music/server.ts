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

import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import type { CheckinTypeServerPlugin, PluginTimelineContext } from 'wwp-shared';
import { isValidTimeZone } from 'wwp-shared';
import { query } from '../../server/src/db';
import { timelineColumnList } from '../../server/src/plugins/timeline';
import { timelineWhereConditions } from '../../server/src/plugins/sql';
import { createImportUpload, removeImportFile } from '../../server/src/plugins/uploads';
import { ownedCheckinTypes, pluginTimestampUnion } from '../../server/src/plugins/registry';
import { parseCheckinIdList, isUuid } from '../../server/src/services/batching';
import { clampInt } from '../../server/src/services/queryParams';
import { parseLibraryParams } from '../../server/src/services/libraryQuery';
import { normalizeCompanions } from '../../server/src/services/companions';
import { currentUserId, preserveUserContext, runAsUser } from '../../server/src/auth/context';
import {
  API_MOUNT,
  SERVER_INFO,
  failure,
  newScrobbleSuccess,
  parseDateRange,
  parseNewScrobble,
  scrobbleListResponse,
} from './services/scrobblerApi';
import { listError } from '../../server/src/services/lists';
import { mountRankRoutes } from '../../server/src/services/lists/routes';
import { suggest } from './services/suggest';
import { parseScrobbleExport } from './services/importParser';
import { parseLastfmCsv } from './services/lastfmCsv';
import {
  addItem,
  kit as listKit,
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
  LIBRARY_SORTS,
  getMusicSettings,
  getSessionTracks,
  getTotals,
  deleteScrobble,
  findScrobblerKeyOwner,
  getScrobbleDetail,
  updateScrobble,
  insertManualScrobble,
  insertScrobble,
  insertScrobblesBulk,
  listScrobbles,
  recomputeTimezones,
  regenerateScrobblerKey,
  updateMusicSettings,
  type LibraryView,
  type ScrobbleEdit,
} from './services/scrobbles';

const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;
const ALL_PER_PAGE = 1_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateParam(raw: unknown): string | null {
  return typeof raw === 'string' && DATE_RE.test(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Scrobbler protocol: mounted at the server root, outside the login guard.
// The scrobbler key says whose account a request is for.
// ---------------------------------------------------------------------------

const scrobblerRouter = Router();

/** The user a presented key belongs to, or null (missing, wrong, or ambiguous). */
async function keyOwner(presented: unknown): Promise<string | null> {
  if (typeof presented !== 'string' || !presented) return null;
  return findScrobblerKeyOwner(presented);
}

/** Run the rest of the request as the key's owner; 403 without a valid key. */
async function scrobblerUser(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = await keyOwner(req.body?.key ?? req.query.key);
    if (!userId) return res.status(403).json(failure('authentication_fail', 'Invalid API key'));
    runAsUser(userId, () => next());
  } catch (err) {
    console.error('Scrobbler key check failed:', err);
    res.status(500).json(failure('server_error', 'Internal error'));
  }
}

scrobblerRouter.get('/serverinfo', (_req: Request, res: Response) => {
  res.json(SERVER_INFO);
});

scrobblerRouter.get('/test', scrobblerUser, (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

scrobblerRouter.post('/newscrobble', scrobblerUser, async (req: Request, res: Response) => {
  try {
    const parsed = parseNewScrobble(req.body);
    if (!parsed.ok) {
      return res.status(400).json(failure('invalid_scrobble', parsed.reason));
    }
    await insertScrobble(currentUserId(), parsed.scrobble);
    // A repeat of a stored play is still a success: the client's goal (the
    // play exists here) is met, and a failure would only make it retry.
    res.json(newScrobbleSuccess(parsed.scrobble));
  } catch (err) {
    console.error('Error storing scrobble:', err);
    res.status(500).json(failure('server_error', 'Failed to store scrobble'));
  }
});

// Multi-scrobbler reads history (to skip plays it has already sent) without
// sending the key, and without a key there is no telling whose history it
// wants: such a read gets an empty page. That only costs a resend, which is
// harmless (a repeat of a stored play is a no-op). With `key`, the key's
// owner's plays are listed.
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
    const echoed = new URLSearchParams();
    for (const key of ['in', 'from', 'until'] as const) {
      const v = req.query[key];
      if (typeof v === 'string') echoed.set(key, v);
    }

    let userId: string | null = null;
    if (req.query.key !== undefined) {
      userId = await keyOwner(req.query.key);
      if (!userId) return res.status(403).json(failure('authentication_fail', 'Invalid API key'));
      // Pagination links carry the key on, or the next page would come back empty.
      echoed.set('key', String(req.query.key));
    }
    if (!userId) return res.json(scrobbleListResponse([], page, perPage, false, echoed));

    // Dates carry no zone and the caller's local day isn't known (multi-scrobbler
    // sends days in its own TZ, so 10:46 PM Eastern is the 25th there but the
    // 26th in UTC). Widen by the largest UTC offset each way: extra plays are
    // harmless to a caller deduplicating by time, missing ones are not.
    if (from) from = new Date(from.getTime() - MAX_UTC_OFFSET_MS);
    if (until) until = new Date(until.getTime() + MAX_UTC_OFFSET_MS);
    const { rows, hasMore } = await listScrobbles(userId, { from, until, page, perPage });
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
    const [settings, counts] = await Promise.all([getMusicSettings(currentUserId()), getCounts(currentUserId())]);
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
    res.json(await updateMusicSettings(currentUserId(), updates));
  } catch (err) {
    console.error('Error saving music settings:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// POST /timezones/refresh - re-assign every play's timezone from the user's
// current check-ins (after adding or fixing check-ins, or an import).
musicRouter.post('/timezones/refresh', async (_req: Request, res: Response) => {
  try {
    res.json({ updated: await recomputeTimezones(currentUserId()) });
  } catch (err) {
    console.error('Error refreshing scrobble timezones:', err);
    res.status(500).json({ error: 'Failed to refresh timezones' });
  }
});

musicRouter.post('/settings/regenerate-key', async (_req: Request, res: Response) => {
  try {
    res.json({ scrobbler_key: await regenerateScrobblerKey(currentUserId()) });
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
      getTotals(currentUserId(), from, to),
      getLibrary(currentUserId(), 'songs', from, to, { limit }),
      getLibrary(currentUserId(), 'artists', from, to, { limit }),
      getLibrary(currentUserId(), 'albums', from, to, { limit }),
    ]);
    res.json({ totals, top_songs: top_songs.rows, top_artists: top_artists.rows, top_albums: top_albums.rows });
  } catch (err) {
    console.error('Error loading music stats:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// GET /library?view=songs|artists|albums&from&to&q&sort&dir&limit&offset -> { rows, total }
musicRouter.get('/library', async (req: Request, res: Response) => {
  try {
    const view = (['songs', 'artists', 'albums'] as const).includes(req.query.view as LibraryView)
      ? (req.query.view as LibraryView)
      : 'songs';
    const from = dateParam(req.query.from);
    const to = dateParam(req.query.to);
    const params = parseLibraryParams(req.query, { sorts: Object.keys(LIBRARY_SORTS), defaultSort: 'plays' });
    res.json(await getLibrary(currentUserId(), view, from, to, params));
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
    res.json(await getReflectionTracks(currentUserId(), date));
  } catch (err) {
    console.error('Error loading music reflection:', err);
    res.status(500).json({ error: 'Failed to load music reflection' });
  }
});

// ---- Album artwork and release info -------------------------------------

musicRouter.get('/albums/status', async (_req: Request, res: Response) => {
  try {
    const userId = currentUserId();
    res.json({ enabled: albumLookupEnabled(), albums: await getAlbumCounts(userId), job: getBackfillStatus(userId) });
  } catch (err) {
    console.error('Error loading album status:', err);
    res.status(500).json({ error: 'Failed to load album status' });
  }
});

musicRouter.post('/albums/backfill', async (req: Request, res: Response) => {
  try {
    if (!albumLookupEnabled()) return res.status(503).json({ error: 'Album lookup is disabled' });
    const userId = currentUserId();
    if (getBackfillStatus(userId).state === 'running') return res.status(409).json({ error: 'A lookup is already running' });
    res.status(202).json(await startBackfill(userId, { retryMissing: req.body?.retry_missing === true }));
  } catch (err) {
    console.error('Error starting album lookup:', err);
    res.status(500).json({ error: 'Failed to start album lookup' });
  }
});

musicRouter.post('/albums/backfill/cancel', (_req: Request, res: Response) => {
  const userId = currentUserId();
  cancelBackfill(userId);
  res.json(getBackfillStatus(userId));
});

// ?ref=<album_ref from a row> or ?art_id=<cover id>
musicRouter.get('/album-view', async (req: Request, res: Response) => {
  try {
    const ref = typeof req.query.ref === 'string' && req.query.ref.length <= 2000 ? req.query.ref : undefined;
    const artId = typeof req.query.art_id === 'string' ? req.query.art_id : undefined;
    if (artId !== undefined && !isUuid(artId)) return res.status(400).json({ error: 'Invalid cover id' });
    if (ref === undefined && artId === undefined) return res.status(400).json({ error: 'ref or art_id is required' });
    const album = await getAlbumView(currentUserId(), { ref, artId });
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
    const file = await getAlbumArtFile(currentUserId(), id, req.query.size === 'large' ? 'large' : 'thumb');
    if (!file) return res.status(404).end();
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.type('image/jpeg').sendFile(file);
  } catch (err) {
    console.error('Error serving album art:', err);
    res.status(500).end();
  }
});

// ---- Lists of songs and albums -------------------------------------------

const IDENT_MAX = 2000;
const ident = (v: unknown): string | null => (typeof v === 'string' && v.length <= IDENT_MAX ? v : null);

musicRouter.get('/lists', async (_req: Request, res: Response) => {
  try {
    res.json(await getLists(currentUserId()));
  } catch (err) {
    listError(res, err, 'loading lists');
  }
});

musicRouter.post('/lists', async (req: Request, res: Response) => {
  try {
    res.status(201).json(await createList(currentUserId(), req.body?.name));
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
    const created = await createListWithItems(currentUserId(), req.body?.name, items);
    if (!created) return res.status(404).json({ error: 'None of those songs or albums were found' });
    res.status(201).json(created);
  } catch (err) {
    listError(res, err, 'creating the list');
  }
});

musicRouter.put('/lists/:id', async (req: Request, res: Response) => {
  try {
    if (!isUuid(String(req.params.id))) return res.status(400).json({ error: 'Invalid list id' });
    const list = await renameList(currentUserId(), String(req.params.id), req.body?.name);
    if (!list) return res.status(404).json({ error: 'List not found' });
    res.json(list);
  } catch (err) {
    listError(res, err, 'renaming the list');
  }
});

musicRouter.delete('/lists/:id', async (req: Request, res: Response) => {
  try {
    if (!isUuid(String(req.params.id))) return res.status(400).json({ error: 'Invalid list id' });
    if (!(await deleteList(currentUserId(), String(req.params.id)))) return res.status(404).json({ error: 'List not found' });
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
      result = await addItem(currentUserId(), listId, { kind: 'album', album_ref: b.album_ref });
    } else if (b.kind === 'song' && ident(b.song_key)) {
      result = await addItem(currentUserId(), listId, { kind: 'song', song_key: b.song_key, album_ref: ident(b.album_ref) });
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
    if (!(await removeItem(currentUserId(), listId, itemId))) return res.status(404).json({ error: 'Item not found' });
    res.json({ id: itemId });
  } catch (err) {
    listError(res, err, 'removing from the list');
  }
});

mountRankRoutes(musicRouter, listKit);

// One list's items with all-time plays of each.
musicRouter.get('/lists/:id/items', async (req: Request, res: Response) => {
  try {
    const listId = String(req.params.id);
    if (!isUuid(listId)) return res.status(400).json({ error: 'Invalid list id' });
    const items = await getListItems(currentUserId(), listId);
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
    res.json(await suggest(currentUserId(), { artist: text(req.query.artist), title: text(req.query.title) }));
  } catch (err) {
    console.error('Error suggesting songs:', err);
    res.status(500).json({ error: 'Failed to look up songs' });
  }
});

const clean = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Read and check the fields of a hand-entered or edited play. */
function parsePlay(b: Record<string, any>): { error: string } | { play: ScrobbleEdit } {
  const title = clean(b.title, 300);
  const names = (v: unknown) => (Array.isArray(v) ? v : []).flatMap((a: unknown) => (clean(a, 200) ? [clean(a, 200) as string] : [])).slice(0, 20);
  const artists = names(b.artists);
  const playedAt = new Date(b.played_at);
  if (!title || artists.length === 0) return { error: 'A song needs a title and an artist' };
  if (Number.isNaN(playedAt.getTime()) || playedAt.getTime() > Date.now() + 24 * 3600_000) {
    return { error: 'Give the time it was played (not more than a day ahead)' };
  }
  const length = Number(b.track_length);
  const lat = b.latitude === null || b.latitude === undefined ? null : Number(b.latitude);
  const lng = b.longitude === null || b.longitude === undefined ? null : Number(b.longitude);
  const located = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return {
    play: {
      playedAt,
      title,
      artists,
      album: clean(b.album, 300),
      albumArtists: names(b.album_artists),
      trackLength: Number.isFinite(length) && length > 0 && length <= 86_400 ? Math.round(length) : null,
      timezone: typeof b.timezone === 'string' && isValidTimeZone(b.timezone) ? b.timezone : null,
      note: clean(b.note, 2000),
      latitude: located ? lat : null,
      longitude: located ? lng : null,
      locationAccuracy: located && Number.isInteger(b.location_accuracy) && b.location_accuracy >= 0 ? b.location_accuracy : null,
      companions: normalizeCompanions(b.companions).slice(0, 20),
    },
  };
}

// POST /scrobbles - write down a song you heard. A play of the same song around
// then already on file is reported (409) unless `force` is sent.
musicRouter.post('/scrobbles', async (req: Request, res: Response) => {
  try {
    const parsed = parsePlay(req.body ?? {});
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const { companions, ...play } = parsed.play;
    const outcome = await insertManualScrobble(currentUserId(), play, { force: req.body?.force === true, companions });
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

// GET /scrobbles/:id - one play with its song history and place in its session.
musicRouter.get('/scrobbles/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid id' });
    const detail = await getScrobbleDetail(currentUserId(), id);
    if (!detail) return res.status(404).json({ error: 'No such play' });
    res.json(detail);
  } catch (err) {
    console.error('Error loading scrobble:', err);
    res.status(500).json({ error: 'Failed to load the play' });
  }
});

// PUT /scrobbles/:id - correct any play (a scrobbler's too).
musicRouter.put('/scrobbles/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid id' });
    const parsed = parsePlay(req.body ?? {});
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const result = await updateScrobble(currentUserId(), id, parsed.play);
    if (result.status === 'updated') return res.json({ id, session_id: result.sessionId });
    if (result.status === 'conflict') return res.status(409).json({ error: 'Another play already has that time and song' });
    res.status(404).json({ error: 'No such play' });
  } catch (err) {
    console.error('Error updating scrobble:', err);
    res.status(500).json({ error: 'Failed to save the changes' });
  }
});

// DELETE /scrobbles/:id - remove a play, whatever its source.
musicRouter.delete('/scrobbles/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid id' });
    if (!(await deleteScrobble(currentUserId(), id))) return res.status(404).json({ error: 'No such play' });
    res.json({ id });
  } catch (err) {
    console.error('Error deleting scrobble:', err);
    res.status(500).json({ error: 'Failed to delete the play' });
  }
});

/**
 * How far back before a check-in its "what was playing" songs reach. Fixed
 * rather than the session gap: only songs right before arriving are worth
 * showing on the check-in.
 */
const LISTENING_BEFORE_MINUTES = 10;

// GET /around?checkin_ids=a,b - what was playing at the end of each check-in
// (see getListeningBefore). Check-ins with nothing to show are omitted.
musicRouter.get('/around', async (req: Request, res: Response) => {
  try {
    const checkinIds = parseCheckinIdList(req.query.checkin_ids);
    if (checkinIds.length === 0) return res.json({});
    // Only the caller's own check-ins: another user's would leak its timing.
    const owned = await ownedCheckinTypes(currentUserId(), checkinIds);
    if (owned.size === 0) return res.json({});
    // Anchor times come from each check-in type's own plugin hook.
    const anchors = await query(pluginTimestampUnion('         '), [[...owned.keys()]]);
    const settings = await getMusicSettings(currentUserId());
    const found = await getListeningBefore(
      currentUserId(),
      anchors.rows.map((r: { id: string; checked_in_at: string }) => ({ id: r.id, time: new Date(r.checked_in_at) })),
      LISTENING_BEFORE_MINUTES,
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
    res.json(await getSessionTracks(currentUserId(), id));
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
      const inserted = await insertScrobblesBulk(currentUserId(), parsed.scrobbles);
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
  preserveUserContext(importUpload.single('file')),
  importHandler(parseScrobbleExport, ['File is not valid JSON', 'No scrobbles found in file']),
);

// POST /import/lastfm - Last.fm CSV history export
musicRouter.post(
  '/import/lastfm',
  preserveUserContext(importUpload.single('file')),
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
    { name: 'scrobbler_key', type: 'string', label: 'Scrobbler key', uniquePerUser: true },
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
    await run(`DELETE FROM companions WHERE checkin_type = '${PLUGIN_ID}' AND user_id = $1`, [user_id]);
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
