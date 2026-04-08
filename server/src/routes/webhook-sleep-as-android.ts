import { Router, Request, Response } from 'express';
import { query } from '../db';

const router = Router();
const USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Parse a Sleep as Android timestamp value.
 * The app sends UNIX timestamps – sometimes in milliseconds (13-digit),
 * sometimes in seconds (10-digit). We detect which by magnitude.
 */
function parseWebhookTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  const date = num > 1e10 ? new Date(num) : new Date(num * 1000);
  return isNaN(date.getTime()) ? null : date;
}

// POST / - receive a Sleep as Android webhook event
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const { event, value1, value2, value3 } = body;

    if (!event || typeof event !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid event field' });
    }

    // Log every event so the UI can display a received count.
    await query(
      `INSERT INTO sleep_webhook_events (user_id, event, value1, value2, value3, raw_body)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [USER_ID, event, value1 ?? null, value2 ?? null, value3 ?? null, body]
    );

    if (event === 'sleep_tracking_started') {
      const startTime = parseWebhookTimestamp(value1) ?? new Date();
      // Use start-time-in-ms as a synthetic sleep_as_android_id.
      // Real CSV-exported IDs are tiny sequential integers; ms timestamps
      // are in the 10^12 range so there is no overlap.
      const androidId = startTime.getTime();

      await query(
        `INSERT INTO sleep_entries
           (user_id, sleep_as_android_id, sleep_timezone, started_at, ended_at, is_pending)
         VALUES ($1, $2, 'UTC', $3, $3, TRUE)
         ON CONFLICT (user_id, sleep_as_android_id) DO UPDATE
           SET started_at  = EXCLUDED.started_at,
               ended_at    = EXCLUDED.ended_at,
               is_pending  = TRUE,
               updated_at  = NOW()`,
        [USER_ID, androidId, startTime.toISOString()]
      );
    } else if (event === 'sleep_tracking_stopped') {
      const startTime = parseWebhookTimestamp(value1);
      const endTime = parseWebhookTimestamp(value2) ?? new Date();

      if (startTime) {
        // Close the specific pending session opened by this start time.
        const androidId = startTime.getTime();
        await query(
          `UPDATE sleep_entries
           SET ended_at   = $2,
               is_pending = FALSE,
               updated_at = NOW()
           WHERE user_id = $1
             AND sleep_as_android_id = $3
             AND is_pending = TRUE`,
          [USER_ID, endTime.toISOString(), androidId]
        );
      } else {
        // No start-time value – close the most recent open session.
        await query(
          `UPDATE sleep_entries
           SET ended_at   = $2,
               is_pending = FALSE,
               updated_at = NOW()
           WHERE id = (
             SELECT id FROM sleep_entries
             WHERE user_id = $1 AND is_pending = TRUE
             ORDER BY started_at DESC
             LIMIT 1
           )`,
          [USER_ID, endTime.toISOString()]
        );
      }
    }
    // All other events are logged but require no sleep_entry mutation.

    res.json({ ok: true });
  } catch (err) {
    console.error('Sleep as Android webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// GET /stats - count of events received for this user
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT COUNT(*)::int AS count FROM sleep_webhook_events WHERE user_id = $1',
      [USER_ID]
    );
    res.json({ count: result.rows[0]?.count ?? 0 });
  } catch (err) {
    console.error('Sleep webhook stats error:', err);
    res.status(500).json({ error: 'Failed to get webhook stats' });
  }
});

export const webhookSleepAsAndroidRouter = router;
