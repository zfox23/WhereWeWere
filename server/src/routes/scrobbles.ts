import { Router, Request, Response } from 'express';
import { query } from '../db';
import { mapWithConcurrency, parseCheckinIdList } from '../services/batching';
import { pluginTimestampUnion } from '../plugins/registry';

const MALOJA_TIMEOUT_MS = 10_000;
const MALOJA_CONCURRENCY = 6;

const router = Router();

import { DEFAULT_USER_ID as USER_ID } from '../constants';

function formatMalojaDate(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

interface MalojaScrobble {
  time: number;
  track?: {
    artists?: string[];
    title?: string;
  };
  duration?: number;
}

const EMPTY_RESULT_MIN_AGE_MS = 24 * 60 * 60 * 1000;

interface CachedScrobble {
  artists: string[];
  title: string;
  time: number;
}

// GET / - batch fetch scrobbles for check-ins
router.get('/', async (req: Request, res: Response) => {
  try {
    const checkinIds = parseCheckinIdList(req.query.checkin_ids);
    if (checkinIds.length === 0) return res.json({});

    // Get maloja_url from settings
    const settingsResult = await query(
      'SELECT maloja_url FROM user_settings WHERE user_id = $1',
      [USER_ID]
    );
    const malojaUrl = settingsResult.rows[0]?.maloja_url;
    if (!malojaUrl) return res.json({});

    // Check cache
    const cachedResult = await query(
      'SELECT checkin_id, scrobbles FROM checkin_scrobbles WHERE checkin_id = ANY($1::uuid[])',
      [checkinIds]
    );
    const cached = new Map<string, CachedScrobble[]>(
      cachedResult.rows.map((r: any) => [r.checkin_id, r.scrobbles])
    );

    const uncachedIds = checkinIds.filter((id) => !cached.has(id));

    if (uncachedIds.length > 0) {
      // Get anchor timestamps for uncached IDs across all check-in types
      // (each resolves its rows via its plugin hook).
      const checkinsResult = await query(
        `${pluginTimestampUnion('         ')}`,
        [uncachedIds]
      );

      // Determine which dates we need to fetch from Maloja
      const datesToFetch = new Set<string>();
      const checkinData: { id: string; time: Date }[] = [];

      for (const row of checkinsResult.rows) {
        const t = new Date(row.checked_in_at);
        checkinData.push({ id: row.id, time: t });

        const windowStart = new Date(t.getTime() - 10 * 60 * 1000);
        const windowEnd = new Date(t.getTime() + 10 * 60 * 1000);
        datesToFetch.add(formatMalojaDate(windowStart));
        datesToFetch.add(formatMalojaDate(windowEnd));
      }

      // Fetch scrobbles from Maloja for each unique date
      const dateScrobbles = new Map<string, MalojaScrobble[]>();
      const baseUrl = malojaUrl.replace(/\/+$/, '');

      await mapWithConcurrency(
        Array.from(datesToFetch),
        MALOJA_CONCURRENCY,
        async (date) => {
          try {
            const url = `${baseUrl}/apis/mlj_1/scrobbles?in=${date}`;
            const response = await fetch(url, { signal: AbortSignal.timeout(MALOJA_TIMEOUT_MS) });
            if (response.ok) {
              const data = await response.json() as { list?: MalojaScrobble[] };
              dateScrobbles.set(date, data.list || []);
            }
          } catch (err) {
            console.error(`Failed to fetch Maloja scrobbles for ${date}:`, err);
          }
        }
      );

      // Assign scrobbles to each check-in within ±10 min window
      const rowsToCache: { id: string; matched: CachedScrobble[] }[] = [];
      for (const { id, time } of checkinData) {
        const windowStartMs = time.getTime() - 10 * 60 * 1000;
        const windowEndMs = time.getTime() + 10 * 60 * 1000;

        const relevantDates = new Set<string>();
        relevantDates.add(formatMalojaDate(new Date(windowStartMs)));
        relevantDates.add(formatMalojaDate(new Date(windowEndMs)));

        const matched: CachedScrobble[] = [];
        const seen = new Set<number>();

        for (const date of relevantDates) {
          const scrobbles = dateScrobbles.get(date) || [];
          for (const s of scrobbles) {
            const scrobbleMs = s.time * 1000;
            if (scrobbleMs >= windowStartMs && scrobbleMs <= windowEndMs && !seen.has(s.time)) {
              seen.add(s.time);
              matched.push({
                artists: s.track?.artists || [],
                title: s.track?.title || '',
                time: s.time,
              });
            }
          }
        }

        matched.sort((a, b) => a.time - b.time);

        // Cache the result only when it can be trusted: every date was
        // fetched, and an empty result isn't for a check-in so recent that
        // Maloja may simply not have received its scrobbles yet. Otherwise
        // "no music" would stick forever (the read path never re-checks).
        const allDatesFetched = Array.from(relevantDates).every((d) => dateScrobbles.has(d));
        const tooRecentToTrustEmpty = matched.length === 0 && Date.now() - time.getTime() < EMPTY_RESULT_MIN_AGE_MS;
        if (allDatesFetched && !tooRecentToTrustEmpty) {
          rowsToCache.push({ id, matched });
        }

        cached.set(id, matched);
      }

      // One round-trip for the whole batch instead of an INSERT per check-in.
      if (rowsToCache.length > 0) {
        await query(
          `INSERT INTO checkin_scrobbles (checkin_id, scrobbles)
           SELECT t.id, t.scrobbles::jsonb
           FROM unnest($1::uuid[], $2::text[]) AS t(id, scrobbles)
           ON CONFLICT (checkin_id) DO UPDATE SET scrobbles = EXCLUDED.scrobbles, fetched_at = NOW()`,
          [rowsToCache.map((r) => r.id), rowsToCache.map((r) => JSON.stringify(r.matched))]
        );
      }
    }

    // Build response
    const result: Record<string, CachedScrobble[]> = {};
    for (const id of checkinIds) {
      result[id] = cached.get(id) || [];
    }

    res.json(result);
  } catch (err) {
    console.error('Error fetching scrobbles:', err);
    res.status(500).json({ error: 'Failed to fetch scrobbles' });
  }
});

// GET /by-date - fetch all scrobbles for a specific date
router.get('/by-date', async (req: Request, res: Response) => {
  try {
    const dateStr = req.query.date as string | undefined;
    if (!dateStr) {
      return res.json([]);
    }

    // Get maloja_url from settings
    const settingsResult = await query(
      'SELECT maloja_url FROM user_settings WHERE user_id = $1',
      [USER_ID]
    );
    const malojaUrl = settingsResult.rows[0]?.maloja_url;
    if (!malojaUrl) return res.json([]);

    // Fetch scrobbles from Maloja for the date
    const baseUrl = malojaUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/apis/mlj_1/scrobbles?in=${dateStr}`, {
      signal: AbortSignal.timeout(MALOJA_TIMEOUT_MS),
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch Maloja scrobbles for ${dateStr}:`, response.statusText);
      return res.json([]);
    }

    const data = await response.json() as { list?: MalojaScrobble[] };
    const scrobbles = (data.list || []).map(s => ({
      artists: s.track?.artists || [],
      title: s.track?.title || '',
      time: s.time,
    }));

    // Sort by time (most recent first) and return
    scrobbles.sort((a, b) => b.time - a.time);
    res.json(scrobbles);
  } catch (err) {
    console.error('Error fetching scrobbles by date:', err);
    res.status(500).json({ error: 'Failed to fetch scrobbles' });
  }
});

export const scrobblesRouter = router;
