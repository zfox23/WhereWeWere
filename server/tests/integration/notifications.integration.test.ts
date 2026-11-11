/**
 * Notifications: device subscriptions, per-plugin toggles, the Mood
 * reminder schedule, and the scheduler's exactly-once delivery. web-push is
 * mocked; nothing leaves the process.
 */

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    generateVAPIDKeys: () => ({ publicKey: 'BTestPublicKey', privateKey: 'test-private-key' }),
  },
}));

import { createApp } from '../../src/index';
import { query } from '../../src/db';
import {
  DEFAULT_USER_ID as A,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../helpers/testDb';
import { createTestUser, type TestUser } from '../helpers/auth';
import { resetSchedulerState, runNotificationTick } from '../../src/services/notifications/scheduler';
import { resetVapidKeysCache } from '../../src/services/notifications/vapid';
import { notifyUser } from '../../src/services/notifications/send';

const app = createApp();

const ENDPOINT = 'https://push.example.test/send/device-1';
const subscription = (endpoint = ENDPOINT) => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } });

async function subscribe(endpoint = ENDPOINT, timezone = 'UTC', cookie?: string) {
  let req = request(app).post('/api/v1/notifications/subscriptions');
  if (cookie) req = req.set('Cookie', cookie);
  return req.send({ subscription: subscription(endpoint), timezone });
}

async function subscriptionOwner(endpoint = ENDPOINT): Promise<string | null> {
  const r = await query('SELECT user_id FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  return r.rows[0]?.user_id ?? null;
}

/** HH:MM (UTC) of an instant. */
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

describe('Notifications', () => {
  let b: TestUser;

  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
    resetVapidKeysCache();
    resetSchedulerState();
    sendNotification.mockReset();
    sendNotification.mockResolvedValue({ statusCode: 201 });
    b = await createTestUser('notify_b');
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('generates the VAPID key pair once and keeps it', async () => {
    const first = await request(app).get('/api/v1/notifications/vapid-public-key');
    expect(first.status).toBe(200);
    expect(first.body.publicKey).toBe('BTestPublicKey');
    resetVapidKeysCache();
    const second = await request(app).get('/api/v1/notifications/vapid-public-key');
    expect(second.body.publicKey).toBe(first.body.publicKey);
    const rows = await query(`SELECT count(*)::int AS n FROM server_secrets WHERE key = 'vapid'`);
    expect(rows.rows[0].n).toBe(1);
  });

  it('subscribes, refreshes, and unsubscribes a device', async () => {
    expect((await subscribe()).body).toMatchObject({ subscribed: true, timezone: 'UTC' });
    const refreshed = await request(app)
      .post('/api/v1/notifications/subscriptions')
      .send({ subscription: subscription(), timezone: 'America/Chicago', refreshOnly: true });
    expect(refreshed.body).toMatchObject({ subscribed: true, timezone: 'America/Chicago' });

    const del = await request(app).delete('/api/v1/notifications/subscriptions').send({ endpoint: ENDPOINT });
    expect(del.status).toBe(200);
    expect(await subscriptionOwner()).toBeNull();
  });

  it('rejects invalid subscriptions and timezones', async () => {
    const badTz = await subscribe(ENDPOINT, 'Mars/Olympus');
    expect(badTz.status).toBe(400);
    const badEndpoint = await subscribe('http://insecure.example.test/x');
    expect(badEndpoint.status).toBe(400);
  });

  it('refreshOnly never claims another account’s device; a full subscribe moves it', async () => {
    await subscribe();
    const refresh = await request(app)
      .post('/api/v1/notifications/subscriptions')
      .set('Cookie', b.cookie)
      .send({ subscription: subscription(), timezone: 'UTC', refreshOnly: true });
    expect(refresh.body).toEqual({ subscribed: false, owner: 'other' });
    const unknown = await request(app)
      .post('/api/v1/notifications/subscriptions')
      .set('Cookie', b.cookie)
      .send({ subscription: subscription('https://push.example.test/send/unknown'), timezone: 'UTC', refreshOnly: true });
    expect(unknown.body).toEqual({ subscribed: false, owner: 'none' });
    expect(await subscriptionOwner()).toBe(A);

    // B can't delete A's device.
    await request(app).delete('/api/v1/notifications/subscriptions').set('Cookie', b.cookie).send({ endpoint: ENDPOINT });
    expect(await subscriptionOwner()).toBe(A);

    // B turning notifications on in this browser takes it over.
    await subscribe(ENDPOINT, 'UTC', b.cookie);
    expect(await subscriptionOwner()).toBe(b.id);
  });

  it('lists plugins with notifications and toggles them, defaulting to off', async () => {
    const list = await request(app).get('/api/v1/notifications/plugins');
    expect(list.status).toBe(200);
    const mood = list.body.find((p: { id: string }) => p.id === 'mood');
    expect(mood).toMatchObject({ enabled: false });
    expect(mood.triggers.map((t: { key: string }) => t.key)).toContain('checkin_reminder');

    const on = await request(app).put('/api/v1/notifications/plugins/mood').send({ enabled: true });
    expect(on.body).toEqual({ id: 'mood', enabled: true });
    expect((await request(app).put('/api/v1/notifications/plugins/mood').send({ enabled: 'yes' })).status).toBe(400);
    expect((await request(app).put('/api/v1/notifications/plugins/sleep').send({ enabled: true })).status).toBe(404);

    // B's toggle is separate.
    const bList = await request(app).get('/api/v1/notifications/plugins').set('Cookie', b.cookie);
    expect(bList.body.find((p: { id: string }) => p.id === 'mood').enabled).toBe(false);
  });

  it('validates mood reminder times', async () => {
    const ok = await request(app).put('/api/v1/plugins/mood/settings').send({ reminder_times: ['09:00', '21:30'] });
    expect(ok.status).toBe(200);
    expect(ok.body.reminder_times).toEqual(['09:00', '21:30']);
    const bad = await request(app).put('/api/v1/plugins/mood/settings').send({ reminder_times: ['9am'] });
    expect(bad.status).toBe(400);
    const dup = await request(app).put('/api/v1/plugins/mood/settings').send({ reminder_times: ['09:00', '09:00'] });
    expect(dup.status).toBe(400);
  });

  describe('scheduler', () => {
    const now = Date.now();

    async function setUpReminder(enabled = true) {
      await subscribe();
      // Pretend the device subscribed an hour ago.
      await query(`UPDATE push_subscriptions SET created_at = NOW() - interval '1 hour'`);
      await request(app).put('/api/v1/plugins/mood/settings').send({ reminder_times: [hhmm(now - 5 * 60_000)] });
      await request(app).put('/api/v1/notifications/plugins/mood').send({ enabled });
    }

    it('sends a due mood reminder exactly once', async () => {
      await setUpReminder();
      expect(await runNotificationTick(now)).toEqual({ sent: 1, failed: 0 });
      expect(sendNotification).toHaveBeenCalledTimes(1);
      const [target, body, options] = sendNotification.mock.calls[0];
      expect(target.endpoint).toBe(ENDPOINT);
      expect(JSON.parse(body)).toMatchObject({ title: 'How are you feeling?', url: '/mood-check-in' });
      expect(options).toMatchObject({ urgency: 'high', TTL: 3600 });

      // Same window again (e.g. a restart): the claim blocks a second send.
      resetSchedulerState();
      expect(await runNotificationTick(now + 1000)).toEqual({ sent: 0, failed: 0 });
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it('sends nothing while the plugin toggle is off', async () => {
      await setUpReminder(false);
      expect(await runNotificationTick(now)).toEqual({ sent: 0, failed: 0 });
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('sends nothing without a subscribed device', async () => {
      await setUpReminder();
      await request(app).delete('/api/v1/notifications/subscriptions').send({ endpoint: ENDPOINT });
      expect(await runNotificationTick(now)).toEqual({ sent: 0, failed: 0 });
    });

    it('never sends occurrences from before the device subscribed', async () => {
      await setUpReminder();
      await query(`UPDATE push_subscriptions SET created_at = NOW()`);
      expect(await runNotificationTick(now)).toEqual({ sent: 0, failed: 0 });
    });

    it('ignores occurrences older than the grace window after a restart', async () => {
      await setUpReminder();
      expect(await runNotificationTick(now + 30 * 60_000)).toEqual({ sent: 0, failed: 0 });
    });

    it('uses each device’s timezone', async () => {
      await setUpReminder();
      // The reminder time is UTC wall-clock; in Tokyo that moment is 9h later.
      await query(`UPDATE push_subscriptions SET timezone = 'Asia/Tokyo'`);
      expect(await runNotificationTick(now)).toEqual({ sent: 0, failed: 0 });
    });

    it('skips accounts an admin disabled', async () => {
      await setUpReminder();
      await query('UPDATE users SET disabled_at = NOW() WHERE id = $1', [A]);
      expect(await runNotificationTick(now)).toEqual({ sent: 0, failed: 0 });
    });

    it('passes a request timeout to the push service call', async () => {
      await setUpReminder();
      await runNotificationTick(now);
      expect(sendNotification.mock.calls[0][2]).toMatchObject({ timeout: 10_000 });
    });

    it('deletes a subscription the push service reports gone', async () => {
      await setUpReminder();
      sendNotification.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }));
      expect(await runNotificationTick(now)).toEqual({ sent: 0, failed: 1 });
      expect(await subscriptionOwner()).toBeNull();
    });

    it('drops subscriptions when the account is deleted', async () => {
      await subscribe(ENDPOINT, 'UTC', b.cookie);
      await query('DELETE FROM users WHERE id = $1', [b.id]);
      expect(await subscriptionOwner()).toBeNull();
    });
  });

  it('notifyUser respects the plugin toggle and de-duplicates by occurrence', async () => {
    await subscribe();
    const payload = { title: 'Hi', url: '/mood-check-in' };
    expect(await notifyUser(A, 'mood', 'checkin_reminder', payload)).toEqual({ sent: 0, failed: 0 });
    await request(app).put('/api/v1/notifications/plugins/mood').send({ enabled: true });
    expect(await notifyUser(A, 'mood', 'checkin_reminder', payload, { occurrenceAt: 1000 })).toEqual({ sent: 1, failed: 0 });
    expect(await notifyUser(A, 'mood', 'checkin_reminder', payload, { occurrenceAt: 1000 })).toEqual({ sent: 0, failed: 0 });
    await expect(notifyUser(A, 'mood', 'nope', payload)).rejects.toThrow(/no notification trigger/);
  });

  it('sends a test notification only to the caller’s own device', async () => {
    await subscribe();
    expect((await request(app).post('/api/v1/notifications/test').send({ endpoint: ENDPOINT })).status).toBe(200);
    expect(
      (await request(app).post('/api/v1/notifications/test').set('Cookie', b.cookie).send({ endpoint: ENDPOINT })).status,
    ).toBe(404);
  });
});
