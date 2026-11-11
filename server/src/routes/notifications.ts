/**
 * Notifications (Web Push) routes, all for the signed-in user.
 *
 * GET    /api/v1/notifications/vapid-public-key
 *   { publicKey } for PushManager.subscribe().
 *
 * POST   /api/v1/notifications/subscriptions
 *        { subscription, timezone, refreshOnly?, oldEndpoint? }
 *   Register this device (the user turned notifications on). Upserts on the
 *   push endpoint: a browser re-subscribed under another account moves to
 *   this one. With `refreshOnly` (the app re-posts on every open, which keeps
 *   `timezone` following the device) only a row this user already owns is
 *   updated; `{ subscribed: false, owner }` tells the app this browser isn't
 *   opted in for the signed-in account (`owner: 'other'` when another
 *   account holds it). `oldEndpoint` (the service worker's
 *   pushsubscriptionchange) removes the user's superseded row.
 *
 * DELETE /api/v1/notifications/subscriptions   { endpoint }
 *   Turn notifications off for this device (own rows only).
 *
 * GET    /api/v1/notifications/plugins
 *   Plugins with notification triggers and the user's toggle for each.
 *
 * PUT    /api/v1/notifications/plugins/:pluginId   { enabled }
 *
 * POST   /api/v1/notifications/test   { endpoint }
 *   Send a test notification to this device.
 */

import { Router, Request, Response } from 'express';
import { isValidTimeZone, NOTIFICATIONS_ENABLED_KEY } from 'wwp-shared';
import { query } from '../db';
import { currentUserId } from '../auth/context';
import { allPlugins, getPlugin } from '../plugins/registry';
import { getPluginSettings, setPluginSettings } from '../plugins/genericStore';
import { getVapidKeys } from '../services/notifications/vapid';
import { sendToSubscription } from '../services/notifications/send';

const router = Router();

const MAX_FIELD = 2048;

function str(value: unknown, max = MAX_FIELD): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

/** The push service URL must be https (every real push service is). */
function validEndpoint(value: unknown): string | null {
  const endpoint = str(value);
  if (!endpoint) return null;
  try {
    return new URL(endpoint).protocol === 'https:' ? endpoint : null;
  } catch {
    return null;
  }
}

router.get('/vapid-public-key', async (_req: Request, res: Response) => {
  const { publicKey } = await getVapidKeys();
  res.json({ publicKey });
});

router.post('/subscriptions', async (req: Request, res: Response) => {
  const userId = currentUserId();
  const sub = req.body?.subscription;
  const endpoint = validEndpoint(sub?.endpoint);
  const p256dh = str(sub?.keys?.p256dh, 256);
  const auth = str(sub?.keys?.auth, 256);
  const timezone = str(req.body?.timezone, 100);
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Invalid push subscription' });
  }
  if (!timezone || !isValidTimeZone(timezone)) {
    return res.status(400).json({ error: 'Invalid timezone' });
  }
  const userAgent = str(req.get('user-agent') ?? null, 512);
  if (req.body?.refreshOnly === true) {
    const refreshed = await query(
      `UPDATE push_subscriptions
       SET p256dh = $3, auth = $4, timezone = $5, user_agent = $6, last_seen_at = NOW()
       WHERE endpoint = $2 AND user_id = $1
       RETURNING timezone`,
      [userId, endpoint, p256dh, auth, timezone, userAgent],
    );
    if (!refreshed.rows[0]) {
      // 'other': another account owns this browser's subscription (the app
      // drops it); 'none': not registered (yet), left alone.
      const held = await query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
      return res.json({ subscribed: false, owner: held.rows.length > 0 ? 'other' : 'none' });
    }
    return res.json({ subscribed: true, timezone: refreshed.rows[0].timezone });
  }
  const oldEndpoint = str(req.body?.oldEndpoint);
  if (oldEndpoint && oldEndpoint !== endpoint) {
    await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [oldEndpoint, userId]);
  }
  const result = await query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, timezone, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE SET
       -- A browser re-subscribed by another account belongs to that account
       -- now; restart its history so it never gets the previous account's
       -- occurrences.
       created_at = CASE WHEN push_subscriptions.user_id = EXCLUDED.user_id
                         THEN push_subscriptions.created_at ELSE NOW() END,
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       timezone = EXCLUDED.timezone,
       user_agent = EXCLUDED.user_agent,
       last_seen_at = NOW()
     RETURNING id, timezone`,
    [userId, endpoint, p256dh, auth, timezone, userAgent],
  );
  res.json({ subscribed: true, timezone: result.rows[0].timezone });
});

router.delete('/subscriptions', async (req: Request, res: Response) => {
  const endpoint = str(req.body?.endpoint);
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  await query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, currentUserId()]);
  res.json({ subscribed: false });
});

router.get('/plugins', async (_req: Request, res: Response) => {
  const userId = currentUserId();
  const out = [];
  for (const plugin of allPlugins()) {
    if (!plugin.notifications?.triggers?.length) continue;
    const settings = await getPluginSettings(userId, plugin);
    out.push({
      id: plugin.id,
      title: plugin.strings.title,
      triggers: plugin.notifications.triggers,
      enabled: settings[NOTIFICATIONS_ENABLED_KEY] === true,
    });
  }
  res.json(out);
});

router.put('/plugins/:pluginId', async (req: Request, res: Response) => {
  const plugin = getPlugin(String(req.params.pluginId));
  if (!plugin?.notifications?.triggers?.length) {
    return res.status(404).json({ error: 'No notifications for that plugin' });
  }
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be true or false' });
  }
  const settings = await setPluginSettings(currentUserId(), plugin, { [NOTIFICATIONS_ENABLED_KEY]: req.body.enabled });
  res.json({ id: plugin.id, enabled: settings[NOTIFICATIONS_ENABLED_KEY] === true });
});

router.post('/test', async (req: Request, res: Response) => {
  const endpoint = str(req.body?.endpoint);
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  const result = await query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
    [endpoint, currentUserId()],
  );
  const sub = result.rows[0];
  if (!sub) return res.status(404).json({ error: 'This device is not subscribed' });
  const sent = await sendToSubscription(sub, {
    title: 'WhereWeWere',
    body: 'Notifications are working on this device.',
    url: '/settings?tab=notifications',
    tag: 'test',
  });
  if (sent.result !== 'sent') {
    return res.status(502).json({ error: sent.error ?? 'Push failed', result: sent.result });
  }
  res.json({ result: 'sent' });
});

export { router as notificationsRouter };
