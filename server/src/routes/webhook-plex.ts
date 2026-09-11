import { Router, Request, Response } from 'express';
import multer from 'multer';
import { query } from '../db';
import { upsertMediaItem } from './media';

const router = Router();
const USER_ID = '00000000-0000-0000-0000-000000000001';

// Plex posts webhook payloads as multipart/form-data (a JSON part, sometimes
// with an attached JPEG poster). Memory storage keeps this simple; we only
// ever read the JSON part and ignore the binary poster.
const plexUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Infer the user's local timezone at the given reference time by examining the
 * most recent check-in timezone at or before the reference time, falling back
 * to 'UTC'. Same strategy as the Sleep as Android webhook.
 */
async function inferPlexTimezone(referenceTime: Date): Promise<string> {
  const checkinResult = await query(
    `SELECT checkin_timezone
     FROM checkins
     WHERE user_id = $1
       AND checkin_timezone IS NOT NULL
       AND checked_in_at <= $2
     ORDER BY checked_in_at DESC
     LIMIT 1`,
    [USER_ID, referenceTime.toISOString()]
  );
  if (checkinResult.rows[0]?.checkin_timezone) {
    return checkinResult.rows[0].checkin_timezone as string;
  }

  const mediaResult = await query(
    `SELECT checkin_timezone
     FROM media_checkins
     WHERE user_id = $1
       AND checkin_timezone IS NOT NULL
       AND checked_in_at <= $2
     ORDER BY checked_in_at DESC
     LIMIT 1`,
    [USER_ID, referenceTime.toISOString()]
  );
  if (mediaResult.rows[0]?.checkin_timezone) {
    return mediaResult.rows[0].checkin_timezone as string;
  }

  return 'UTC';
}

/**
 * Split the stored plex_usernames filter into a normalized set of
 * lowercase, trimmed usernames. An empty/missing filter means "track all".
 */
function parseUsernameFilter(raw: string | null | undefined): Set<string> | null {
  if (!raw) return null;
  const names = raw
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length > 0);
  return names.length > 0 ? new Set(names) : null;
}

interface PlexScrobble {
  mediaType: 'movie' | 'tv_show';
  title: string;
  externalSource: string | null;
  externalId: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
}

/**
 * Extract the media check-in data from a Plex media.scrobble Metadata object.
 *
 * Movies map straight to a movie; episodes map to a tv_show (WhereWeWere
 * stores episodes as fields on the check-in row, not as entities). A
 * "tmdb://<id>" guid gives us an external identity to dedupe against; any
 * other guid scheme (plex://, hulu://, etc.) falls back to a title-only
 * local item.
 */
function extractScrobble(metadata: Record<string, unknown> | null | undefined): PlexScrobble | null {
  if (!metadata) return null;
  const type = metadata.type;
  const title =
    typeof metadata.title === 'string' && metadata.title.trim()
      ? metadata.title
      : null;
  if (!title) return null;

  const guid = typeof metadata.guid === 'string' ? metadata.guid : null;
  let externalSource: string | null = null;
  let externalId: string | null = null;
  if (guid && guid.startsWith('tmdb://')) {
    const id = guid.slice('tmdb://'.length);
    if (/^\d+$/.test(id)) {
      externalSource = 'tmdb';
      externalId = id;
    }
  }

  if (type === 'movie') {
    return {
      mediaType: 'movie',
      title,
      externalSource,
      externalId,
      seasonNumber: null,
      episodeNumber: null,
      episodeTitle: null,
    };
  }

  if (type === 'episode') {
    const seasonNumber =
      typeof metadata.parentIndex === 'number' && Number.isFinite(metadata.parentIndex)
        ? metadata.parentIndex
        : null;
    const episodeNumber =
      typeof metadata.index === 'number' && Number.isFinite(metadata.index)
        ? metadata.index
        : null;
    const episodeTitle =
      typeof metadata.title === 'string' && metadata.title.trim()
        ? metadata.title
        : null;
    const showTitle =
      typeof metadata.grandparentTitle === 'string' && metadata.grandparentTitle.trim()
        ? metadata.grandparentTitle
        : title;
    return {
      mediaType: 'tv_show',
      title: showTitle,
      externalSource,
      externalId,
      seasonNumber,
      episodeNumber,
      episodeTitle,
    };
  }

  return null;
}

// POST / - receive a Plex webhook event
router.post('/', plexUpload.any(), async (req: Request, res: Response) => {
  try {
    // Plex sends the JSON payload as a multipart part; accept a plain JSON
    // body too so the endpoint is easy to test with curl/supertest.
    let body: Record<string, unknown> | null = null;
    const files = (req.files ?? []) as Express.Multer.File[];
    const file = files.find(
      (f) => f.fieldname === 'payload' || f.fieldname === 'json' || f.originalname.toLowerCase().endsWith('.json')
    );
    if (file) {
      body = JSON.parse(file.buffer.toString('utf8'));
    } else if (req.is('application/json')) {
      body = (req.body as Record<string, unknown>) || {};
    }

    const event = body?.event;
    if (!event || typeof event !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid event field' });
    }

    const account = (body?.Account ?? {}) as Record<string, unknown>;
    const plexUsername = typeof account.title === 'string' ? account.title : null;

    // Log every event so the UI can display a received count.
    await query(
      `INSERT INTO plex_webhook_events (user_id, event, plex_username, raw_body)
       VALUES ($1, $2, $3, $4)`,
      [USER_ID, event, plexUsername, body]
    );

    if (event === 'media.scrobble') {
      // Username filter: only track media viewed by one of the configured
      // Plex users. An empty filter tracks everyone.
      const settingsResult = await query(
        'SELECT plex_usernames FROM user_settings WHERE user_id = $1',
        [USER_ID]
      );
      const filter = parseUsernameFilter(settingsResult.rows[0]?.plex_usernames ?? null);
      if (filter && (!plexUsername || !filter.has(plexUsername.toLowerCase()))) {
        return res.json({ ok: true, skipped: 'username_filter' });
      }

      const scrobble = extractScrobble((body?.Metadata ?? null) as Record<string, unknown> | null);
      if (!scrobble) {
        return res.json({ ok: true, skipped: 'unsupported_metadata' });
      }

      const itemId = await upsertMediaItem({
        media_type: scrobble.mediaType,
        external_source: scrobble.externalSource,
        external_id: scrobble.externalId,
        title: scrobble.title,
      });

      const now = new Date();
      const timezone = await inferPlexTimezone(now);

      // A new check-in is created for every scrobble (no dedupe).
      await query(
        `INSERT INTO media_checkins
           (user_id, media_item_id, season_number, episode_number, episode_title,
            checkin_type, checked_in_at, checkin_timezone)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7)`,
        [
          USER_ID,
          itemId,
          scrobble.seasonNumber,
          scrobble.episodeNumber,
          scrobble.episodeTitle,
          now.toISOString(),
          timezone,
        ]
      );
    }
    // All other events are logged but require no media mutation.

    res.json({ ok: true });
  } catch (err) {
    console.error('Plex webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /stats - count of events received for this user
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT COUNT(*)::int AS count FROM plex_webhook_events WHERE user_id = $1',
      [USER_ID]
    );
    res.json({ count: result.rows[0]?.count ?? 0 });
  } catch (err) {
    console.error('Plex webhook stats error:', err);
    res.status(500).json({ error: 'Failed to get webhook stats' });
  }
});

export const webhookPlexRouter = router;
