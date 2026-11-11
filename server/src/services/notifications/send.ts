/**
 * Notification delivery (Web Push).
 *
 * The core owns every send so a plugin can't skip the user's toggles: a
 * notification goes out only to devices the user subscribed, and only while
 * the plugin's `notifications_enabled` toggle is on.
 */

import webpush from 'web-push';
import type { NotificationPayload } from 'wwp-shared';
import { NOTIFICATIONS_ENABLED_KEY } from 'wwp-shared';
import { query } from '../../db';
import { config } from '../../config';
import { getVapidKeys } from './vapid';
import { getPlugin } from '../../plugins/registry';
import { getPluginSettings } from '../../plugins/genericStore';

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  timezone: string;
  created_at: Date;
}

export type SendResult = 'sent' | 'gone' | 'failed';

/**
 * Push messages are high urgency so Android delivers them promptly instead of
 * holding them for a Doze maintenance window; after an hour a reminder is no
 * longer worth showing, so the push service may drop it.
 */
const PUSH_OPTIONS = { TTL: 60 * 60, urgency: 'high' as const };

/** Only same-origin, app-relative URLs are allowed (the service worker checks too). */
export function safeAppPath(url: unknown): string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') ? url : '/';
}

/**
 * Send one payload to one device. A 404/410 from the push service means the
 * subscription is dead (app uninstalled, permission revoked): its row is
 * deleted. Other failures are reported and the row is kept.
 */
export async function sendToSubscription(
  sub: Pick<PushSubscriptionRow, 'id' | 'endpoint' | 'p256dh' | 'auth'>,
  payload: NotificationPayload,
): Promise<{ result: SendResult; error?: string }> {
  const keys = await getVapidKeys();
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? '',
    url: safeAppPath(payload.url),
    tag: payload.tag,
  });
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      body,
      {
        ...PUSH_OPTIONS,
        vapidDetails: { subject: config.vapidSubject, publicKey: keys.publicKey, privateKey: keys.privateKey },
      },
    );
    return { result: 'sent' };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      return { result: 'gone', error: `Subscription expired (${status})` };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { result: 'failed', error: status ? `${status}: ${message}` : message };
  }
}

export async function listSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
  const result = await query(
    `SELECT id, user_id, endpoint, p256dh, auth, timezone, created_at
     FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return result.rows;
}

/** Whether the user's notifications toggle for `pluginId` is on. */
export async function pluginNotificationsEnabled(userId: string, pluginId: string): Promise<boolean> {
  const plugin = getPlugin(pluginId);
  if (!plugin?.notifications?.triggers?.length) return false;
  const settings = await getPluginSettings(userId, plugin);
  return settings[NOTIFICATIONS_ENABLED_KEY] === true;
}

/**
 * Claim one (device, trigger, occurrence) and send it. Returns null when the
 * occurrence was already claimed (sent earlier, or by another process).
 */
export async function claimAndSend(
  sub: PushSubscriptionRow,
  pluginId: string,
  triggerKey: string,
  occurrenceAt: number,
  payload: NotificationPayload,
): Promise<SendResult | null> {
  const claim = await query(
    `INSERT INTO notification_deliveries (subscription_id, plugin_id, trigger_key, occurrence_at)
     VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
     ON CONFLICT (subscription_id, plugin_id, trigger_key, occurrence_at) DO NOTHING
     RETURNING id`,
    [sub.id, pluginId, triggerKey, occurrenceAt],
  );
  const deliveryId = claim.rows[0]?.id;
  if (!deliveryId) return null;
  const { result, error } = await sendToSubscription(sub, payload);
  if (result !== 'gone') {
    // (A 'gone' row was cascade-deleted with its subscription.)
    await query('UPDATE notification_deliveries SET status = $2, error = $3 WHERE id = $1', [
      deliveryId,
      result,
      error ?? null,
    ]);
  }
  return result;
}

/**
 * Event-driven notifications: send `payload` to every device of `userId`,
 * if the plugin declares `triggerKey` and the user's toggle for it is on.
 *
 * Pass `occurrenceAt` (ms) to make the send idempotent: the same
 * (trigger, occurrence) reaches each device at most once.
 */
export async function notifyUser(
  userId: string,
  pluginId: string,
  triggerKey: string,
  payload: NotificationPayload,
  opts: { occurrenceAt?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const plugin = getPlugin(pluginId);
  if (!plugin?.notifications?.triggers?.some((t) => t.key === triggerKey)) {
    throw new Error(`Plugin ${pluginId} has no notification trigger "${triggerKey}"`);
  }
  if (!(await pluginNotificationsEnabled(userId, pluginId))) return { sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (const sub of await listSubscriptions(userId)) {
    const result =
      opts.occurrenceAt !== undefined
        ? await claimAndSend(sub, pluginId, triggerKey, opts.occurrenceAt, payload)
        : (await sendToSubscription(sub, payload)).result;
    if (result === 'sent') sent += 1;
    else if (result) failed += 1;
  }
  return { sent, failed };
}
