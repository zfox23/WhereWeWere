import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();

const USER_ID = '00000000-0000-0000-0000-000000000001';

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

interface CachedScrobble {
  artists: string[];
  title: string;
  time: number;
}

// GET / - batch fetch scrobbles for check-ins
router.get('/', async (req: Request, res: Response) => {
  try {
    const raw = req.query.checkin_ids as string | undefined;
    const checkinIds = (raw || '').split(',').filter(Boolean);
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
      // Get check-in timestamps for uncached IDs across location and mood check-ins
      const checkinsResult = await query(
        `SELECT id, checked_in_at FROM checkins WHERE id = ANY($1::uuid[])
         UNION ALL
         SELECT id, checked_in_at FROM mood_checkins WHERE id = ANY($1::uuid[])`,
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

      await Promise.all(
        Array.from(datesToFetch).map(async (date) => {
          try {
            const url = `${baseUrl}/apis/mlj_1/scrobbles?in=${date}`;
            const response = await fetch(url);
            if (response.ok) {
              const data = await response.json() as { list?: MalojaScrobble[] };
              dateScrobbles.set(date, data.list || []);
            }
          } catch (err) {
            console.error(`Failed to fetch Maloja scrobbles for ${date}:`, err);
          }
        })
      );

      // Assign scrobbles to each check-in within ±10 min window
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

        // Cache result
        await query(
          `INSERT INTO checkin_scrobbles (checkin_id, scrobbles)
           VALUES ($1, $2)
           ON CONFLICT (checkin_id) DO UPDATE SET scrobbles = $2, fetched_at = NOW()`,
          [id, JSON.stringify(matched)]
        );

        cached.set(id, matched);
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

export const scrobblesRouter = router;
