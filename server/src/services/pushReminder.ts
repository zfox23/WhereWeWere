import { query } from '../db';
import * as webpush from 'web-push';
import { config } from '../config';

// Configure web-push with VAPID details
webpush.setVapidDetails(
  'mailto:noreply@wherewewere.example.com',
  config.vapidPublicKey,
  config.vapidPrivateKey
);

const REMINDER_WINDOW_MS = 5 * 60 * 1000; // 5-minute window around scheduled time

function getCurrentTimeInMinutes(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function timeMatchesWindow(scheduledTime: string): boolean {
  const currentTimeStr = getCurrentTimeInMinutes();
  const [scheduledHours, scheduledMinutes] = scheduledTime.split(':').map(Number);
  const [currentHours, currentMinutes] = currentTimeStr.split(':').map(Number);

  const scheduledMs = scheduledHours * 60 * 60 * 1000 + scheduledMinutes * 60 * 1000;
  const currentMs = currentHours * 60 * 60 * 1000 + currentMinutes * 60 * 1000;
  const windowStartMs = scheduledMs - REMINDER_WINDOW_MS / 2;
  const windowEndMs = scheduledMs + REMINDER_WINDOW_MS / 2;

  return currentMs >= windowStartMs && currentMs <= windowEndMs;
}

async function formatTimeLabel(time: string): Promise<string> {
  const [hours, minutes] = time.split(':');
  const d = new Date();
  d.setHours(Number(hours), Number(minutes), 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export async function sendMoodReminder() {
  try {
    console.log('[Mood Reminder Push Job] Starting...');

    // Find all users with active subscriptions and mood reminder times configured
    const usersResult = await query(
      `SELECT DISTINCT u.id, us.mood_reminder_times
       FROM users u
       LEFT JOIN user_settings us ON us.user_id = u.id
       WHERE us.mood_reminder_times IS NOT NULL 
       AND array_length(us.mood_reminder_times, 1) > 0
       AND EXISTS (
         SELECT 1 FROM push_subscriptions ps
         WHERE ps.user_id = u.id AND ps.is_active = true
       )`
    );

    console.log(`[Mood Reminder Push Job] Found ${usersResult.rows.length} users with subscriptions and reminders`);

    for (const userRow of usersResult.rows) {
      const userId: string = userRow.id;
      const reminderTimes = userRow.mood_reminder_times || [];

      // Check if any reminder time matches current window
      const matchingTimes = reminderTimes.filter(timeMatchesWindow);
      if (matchingTimes.length === 0) continue;

      console.log(`[Mood Reminder Push Job] User ${userId} has matching reminder times: ${matchingTimes.join(', ')}`);

      // Get all active subscriptions for this user
      const subsResult = await query(
        `SELECT id, subscription_json FROM push_subscriptions
         WHERE user_id = $1 AND is_active = true`,
        [userId]
      );

      for (const matchingTime of matchingTimes) {
        const timeLabel = formatTimeLabel(matchingTime);

        for (const subRow of subsResult.rows) {
          const subscriptionId = subRow.id;
          const subscription = subRow.subscription_json;

          try {
            // Create push payload
            const payload = JSON.stringify({
              title: 'Mood check-in reminder',
              body: `How are you feeling? Time for your ${timeLabel} mood check-in.`,
              icon: '/icon-192.svg',
              tag: `mood-reminder-${matchingTime}`,
              data: { url: '/mood-check-in' },
            });

            // Send push
            await webpush.sendNotification(subscription, payload);

            console.log(`[Mood Reminder Push Job] Sent push to subscription ${subscriptionId} for ${matchingTime}`);

            // Log successful delivery
            await query(
              `INSERT INTO push_delivery_logs (subscription_id, user_id, reminder_time, status)
               VALUES ($1, $2, $3, 'sent')`,
              [subscriptionId, userId, matchingTime]
            );
          } catch (err: unknown) {
            let errorMessage = 'Unknown error';
            if (err instanceof webpush.WebPushError) {
              errorMessage = `${err.statusCode}: ${err.message}`;

              // Remove subscription if it's expired (410)
              if (err.statusCode === 410) {
                console.log(`[Mood Reminder Push Job] Subscription ${subscriptionId} expired, marking as inactive`);
                await query(
                  `UPDATE push_subscriptions SET is_active = false WHERE id = $1`,
                  [subscriptionId]
                );
              }
            } else if (err instanceof Error) {
              errorMessage = err.message;
            }

            console.error(`[Mood Reminder Push Job] Error sending push to ${subscriptionId}:`, errorMessage);

            // Log failed delivery
            await query(
              `INSERT INTO push_delivery_logs (subscription_id, user_id, reminder_time, status, error_message)
               VALUES ($1, $2, $3, 'failed', $4)`,
              [subscriptionId, userId, matchingTime, errorMessage]
            );
          }
        }
      }
    }

    console.log('[Mood Reminder Push Job] Completed successfully');
  } catch (err) {
    console.error('[Mood Reminder Push Job] Fatal error:', err);
    throw err;
  }
}
