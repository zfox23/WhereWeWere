/**
 * Scheduled notifications.
 *
 * Every minute, for each user with at least one subscribed device and each
 * plugin whose toggle they turned on, asks the plugin which occurrences fell
 * due since the previous tick (in each device's own timezone) and sends each
 * one exactly once: the `notification_deliveries` unique key is claimed
 * before sending, so overlapping ticks, retries, or a second server process
 * can never double-send.
 *
 * After a restart the first tick looks back at most GRACE_MS, so downtime
 * produces at most a slightly late reminder, never a burst of stale ones.
 */

import { NOTIFICATIONS_ENABLED_KEY } from 'wwp-shared';
import { pool, query } from '../../db';
import { runAsUser } from '../../auth/context';
import { allPlugins } from '../../plugins/registry';
import { getPluginSettings } from '../../plugins/genericStore';
import { claimAndSend, type PushSubscriptionRow } from './send';

export const TICK_MS = 60 * 1000;
export const GRACE_MS = 20 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const KEEP_DELIVERIES_DAYS = 7;
/** pg advisory lock id for the scheduler tick (arbitrary, stable). */
const LOCK_ID = 81_000_001;

let lastTickAt: number | null = null;
let lastPruneAt = 0;
let running = false;

/** Test hook: forget the previous tick so the next looks back GRACE_MS. */
export function resetSchedulerState(): void {
  lastTickAt = null;
  lastPruneAt = 0;
}

/**
 * Run one scheduler pass at `now`. Exported for tests; production calls it
 * from the interval started by `startNotificationScheduler`.
 */
export async function runNotificationTick(now = Date.now()): Promise<{ sent: number; failed: number }> {
  const totals = { sent: 0, failed: 0 };
  const plugins = allPlugins().filter((p) => p.notifications?.triggers?.length && p.server.notifications?.dueOccurrences);
  const windowStart = Math.max(lastTickAt ?? now - GRACE_MS, now - GRACE_MS);
  if (now <= windowStart) return totals;

  const lockClient = await pool.connect();
  try {
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!lock.rows[0]?.ok) return totals; // another process is ticking
    try {
      if (plugins.length > 0) {
        const subs = await query(
          `SELECT id, user_id, endpoint, p256dh, auth, timezone, created_at
           FROM push_subscriptions ORDER BY user_id, created_at`,
        );
        const byUser = new Map<string, PushSubscriptionRow[]>();
        for (const row of subs.rows as PushSubscriptionRow[]) {
          const list = byUser.get(row.user_id) ?? [];
          list.push(row);
          byUser.set(row.user_id, list);
        }

        for (const [userId, userSubs] of byUser) {
          await runAsUser(userId, async () => {
            for (const plugin of plugins) {
              try {
                const settings = await getPluginSettings(userId, plugin);
                if (settings[NOTIFICATIONS_ENABLED_KEY] !== true) continue;
                const triggerKeys = new Set(plugin.notifications!.triggers.map((t) => t.key));
                for (const sub of userSubs) {
                  // A device never gets occurrences from before it subscribed.
                  const since = Math.max(windowStart, new Date(sub.created_at).getTime());
                  if (now <= since) continue;
                  const due = await plugin.server.notifications!.dueOccurrences!({
                    user_id: userId,
                    timeZone: sub.timezone,
                    since,
                    now,
                    settings,
                  });
                  for (const occ of due) {
                    if (!triggerKeys.has(occ.trigger_key)) continue;
                    if (!(occ.occurrence_at > since && occ.occurrence_at <= now)) continue;
                    const result = await claimAndSend(sub, plugin.id, occ.trigger_key, occ.occurrence_at, occ.payload);
                    if (result === 'sent') totals.sent += 1;
                    else if (result) totals.failed += 1;
                  }
                }
              } catch (err) {
                console.error(`Notifications: ${plugin.id} failed for user ${userId}:`, err);
              }
            }
          });
        }
      }

      if (now - lastPruneAt >= PRUNE_EVERY_MS) {
        lastPruneAt = now;
        await query(
          `DELETE FROM notification_deliveries WHERE created_at < NOW() - ($1 || ' days')::interval`,
          [String(KEEP_DELIVERIES_DAYS)],
        );
      }
      lastTickAt = now;
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } finally {
    lockClient.release();
  }
  return totals;
}

/** Start the once-a-minute scheduler (called from startServer). */
export function startNotificationScheduler(): void {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runNotificationTick();
    } catch (err) {
      console.error('Notification scheduler tick failed:', err);
    } finally {
      running = false;
    }
  };
  setInterval(tick, TICK_MS).unref();
  void tick();
}
