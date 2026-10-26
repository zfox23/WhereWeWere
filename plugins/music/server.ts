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
import { parseScrobbleExport } from './services/importParser';
import { parseLastfmCsv } from './services/lastfmCsv';
import { DEFAULT_MIN_SESSION_TRACKS, DEFAULT_SESSION_GAP_MINUTES, PLUGIN_ID } from './services/constants';
import {
  getCounts,
  getListeningBefore,
  getLibrary,
  getMusicSettings,
  getSessionTracks,
  getTotals,
  insertScrobble,
  insertScrobblesBulk,
  listScrobbles,
  recomputeTimezones,
  regenerateScrobblerKey,
  updateMusicSettings,
  type LibraryView,
} from './services/scrobbles';

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
    const perPage = clampInt(req.query.perpage, { fallback: 100, min: 1, max: 1000 });
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
    conds.push(`ms.track_count >= ${MIN_TRACKS_SQL}`);
    return conds.build();
  },

  // The payload carries the settings sessions are built with: the framework
  // restores plugin_settings only after this hook runs.
  backupExport: async ({ user_id }) => {
    const [settings, result] = await Promise.all([
      getMusicSettings(user_id),
      query(
        `SELECT played_at, title, artists, album, album_artists, track_length, listened_for, source, timezone
         FROM music_scrobbles WHERE user_id = $1 ORDER BY played_at ASC`,
        [user_id],
      ),
    ]);
    return {
      session_gap_minutes: settings.session_gap_minutes,
      timezone: settings.timezone,
      scrobbles: result.rows,
    };
  },

  backupImport: async ({ user_id, client }, payload) => {
    const body = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as {
      session_gap_minutes?: unknown;
      timezone?: unknown;
      scrobbles?: unknown;
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
      }];
    });
    const gap = Number(body.session_gap_minutes);
    return insertScrobblesBulk(user_id, scrobbles, {
      db: client,
      sessionGapMinutes: Number.isInteger(gap) && gap >= 1 ? gap : undefined,
      fallbackTimezone: typeof body.timezone === 'string' && isValidTimeZone(body.timezone) ? body.timezone : undefined,
    });
  },

  deleteUserData: async ({ user_id, client: txClient }) => {
    const run = (sql: string, values: unknown[]) =>
      txClient ? txClient.query(sql, values) : query(sql, values);
    const result = await run('DELETE FROM music_scrobbles WHERE user_id = $1 RETURNING id', [user_id]);
    await run('DELETE FROM music_sessions WHERE user_id = $1', [user_id]);
    return result.rowCount ?? 0;
  },

  earliestDate: () => ({
    sql: `SELECT MIN((played_at AT TIME ZONE timezone)::date)::text AS date
          FROM music_scrobbles WHERE user_id = $1`,
  }),
};
