import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import app from '../../src/index';
import { query } from '../../src/db';
import { currentUserId, preserveUserContext } from '../../src/auth/context';
import { requireAuth } from '../../src/auth/middleware';
import { hashPassword } from '../../src/auth/passwords';
import { SESSION_COOKIE } from '../../src/auth/sessions';
import {
  setupIntegrationDatabase,
  resetIntegrationDatabase,
  teardownIntegrationDatabase,
  DEFAULT_USER_ID,
} from '../helpers/testDb';
import { createTestUser } from '../helpers/auth';

/** The session cookie a response set, as a Cookie header value. */
function sessionCookie(res: request.Response): string {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = raw.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('no session cookie set');
  return cookie.split(';')[0];
}

async function login(username: string, password: string, remember = false) {
  return request(app).post('/api/v1/auth/login').unset('Cookie').send({ username, password, remember });
}

describe('auth', () => {
  beforeAll(setupIntegrationDatabase);
  beforeEach(async () => {
    await resetIntegrationDatabase();
    await query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [DEFAULT_USER_ID, await hashPassword('correct horse')]);
  });
  afterAll(teardownIntegrationDatabase);

  describe('login', () => {
    it('rejects API requests without a session', async () => {
      const res = await request(app).get('/api/v1/settings').unset('Cookie');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('unauthenticated');
    });

    it('signs in case-insensitively and returns the account', async () => {
      const res = await login('DEFAULT', 'correct horse');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: DEFAULT_USER_ID, username: 'default', is_admin: true });
      expect(res.body.password_hash).toBeUndefined();

      const me = await request(app).get('/api/v1/auth/me').set('Cookie', sessionCookie(res));
      expect(me.body.id).toBe(DEFAULT_USER_ID);
    });

    it('rejects a wrong password and an unknown user with the same message', async () => {
      const wrong = await login('default', 'nope nope');
      const unknown = await login('nobody', 'nope nope');
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.error).toBe(unknown.body.error);
    });

    it('never accepts the legacy no-auth placeholder hash', async () => {
      await query(`UPDATE users SET password_hash = 'no-auth' WHERE id = $1`, [DEFAULT_USER_ID]);
      expect((await login('default', 'no-auth')).status).toBe(401);
    });

    it('sets a persistent cookie only with remember me', async () => {
      const remembered = await login('default', 'correct horse', true);
      const session = await login('default', 'correct horse', false);
      const cookieOf = (r: request.Response) =>
        ([] as string[]).concat(r.headers['set-cookie']).find((c) => c.startsWith(SESSION_COOKIE))!;
      expect(cookieOf(remembered)).toMatch(/Max-Age=2592000/);
      expect(cookieOf(remembered)).toMatch(/HttpOnly/);
      expect(cookieOf(session)).not.toMatch(/Max-Age|Expires/);
    });

    it('throttles repeated failures for a username', async () => {
      for (let i = 0; i < 10; i++) await login('default', 'wrong password');
      const blocked = await login('default', 'correct horse');
      expect(blocked.status).toBe(429);
    });

    it('refuses disabled accounts', async () => {
      await query('UPDATE users SET disabled_at = NOW() WHERE id = $1', [DEFAULT_USER_ID]);
      expect((await login('default', 'correct horse')).status).toBe(403);
    });

    it('logout ends the session', async () => {
      const cookie = sessionCookie(await login('default', 'correct horse'));
      await request(app).post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
      expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
    });

    it('expired sessions are rejected', async () => {
      const cookie = sessionCookie(await login('default', 'correct horse'));
      await query(`UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second'`);
      expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(401);
    });
  });

  describe('temporary passwords', () => {
    it('blocks the app until the password is changed, then ends other sessions', async () => {
      await query('UPDATE users SET must_change_password = TRUE WHERE id = $1', [DEFAULT_USER_ID]);
      const first = sessionCookie(await login('default', 'correct horse'));
      const second = sessionCookie(await login('default', 'correct horse'));

      const blocked = await request(app).get('/api/v1/settings').set('Cookie', first);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('password_change_required');
      expect((await request(app).get('/api/v1/auth/me').set('Cookie', first)).body.must_change_password).toBe(true);

      const changed = await request(app)
        .put('/api/v1/auth/password')
        .set('Cookie', first)
        .send({ current_password: 'correct horse', new_password: 'battery staple' });
      expect(changed.status).toBe(200);
      expect(changed.body.must_change_password).toBe(false);

      expect((await request(app).get('/api/v1/settings').set('Cookie', first)).status).toBe(200);
      expect((await request(app).get('/api/v1/auth/me').set('Cookie', second)).status).toBe(401);
      expect((await login('default', 'battery staple')).status).toBe(200);
    });

    it('requires the current password and a valid new one', async () => {
      const bad = await request(app).put('/api/v1/auth/password').send({ current_password: 'wrong', new_password: 'longenough' });
      expect(bad.status).toBe(400);
      const short = await request(app).put('/api/v1/auth/password').send({ current_password: 'correct horse', new_password: 'short' });
      expect(short.status).toBe(400);
    });
  });

  describe('profile', () => {
    it('changes username and display name; usernames are unique ignoring case', async () => {
      await createTestUser('taken');
      expect((await request(app).put('/api/v1/auth/profile').send({ username: 'TAKEN' })).status).toBe(409);
      expect((await request(app).put('/api/v1/auth/profile').send({ username: 'no spaces' })).status).toBe(400);

      const res = await request(app).put('/api/v1/auth/profile').send({ username: 'Zach', display_name: '  Zach F  ' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ username: 'Zach', display_name: 'Zach F' });
      expect((await login('zach', 'correct horse')).status).toBe(200);
    });
  });

  describe('sessions', () => {
    it('lists and revokes only the caller’s sessions', async () => {
      const other = await createTestUser('other');
      const list = await request(app).get('/api/v1/auth/sessions');
      expect(list.body).toHaveLength(1);
      expect(list.body[0].current).toBe(true);

      const otherSession = await query('SELECT id FROM sessions WHERE user_id = $1', [other.id]);
      const res = await request(app).delete(`/api/v1/auth/sessions/${otherSession.rows[0].id}`);
      expect(res.status).toBe(404);
      expect((await request(app).get('/api/v1/auth/me').set('Cookie', other.cookie)).status).toBe(200);
    });

    it('sign out everywhere ends every session of the user only', async () => {
      const other = await createTestUser('other');
      const extra = sessionCookie(await login('default', 'correct horse'));
      await request(app).post('/api/v1/auth/sessions/sign-out-everywhere').expect(204);
      expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
      expect((await request(app).get('/api/v1/auth/me').set('Cookie', extra)).status).toBe(401);
      expect((await request(app).get('/api/v1/auth/me').set('Cookie', other.cookie)).status).toBe(200);
    });
  });

  describe('webhook token', () => {
    it('is per-user and can be regenerated', async () => {
      const other = await createTestUser('other');
      const mine = (await request(app).get('/api/v1/auth/webhook-token')).body.token;
      const theirs = (await request(app).get('/api/v1/auth/webhook-token').set('Cookie', other.cookie)).body.token;
      expect(mine).toMatch(/^[0-9a-f]{64}$/);
      expect(theirs).not.toBe(mine);
      const regenerated = (await request(app).post('/api/v1/auth/webhook-token/regenerate')).body.token;
      expect(regenerated).not.toBe(mine);
    });
  });

  describe('admin user management', () => {
    it('is admin-only', async () => {
      const plain = await createTestUser('plain');
      expect((await request(app).get('/api/v1/admin/users').set('Cookie', plain.cookie)).status).toBe(403);
    });

    it('creates users who must change their password', async () => {
      const res = await request(app).post('/api/v1/admin/users').send({ username: 'newbie', password: 'temporary1', display_name: 'New' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ username: 'newbie', is_admin: false, must_change_password: true });
      expect((await request(app).post('/api/v1/admin/users').send({ username: 'NEWBIE', password: 'temporary1' })).status).toBe(409);

      const signedIn = await login('newbie', 'temporary1');
      expect(signedIn.status).toBe(200);
      expect(signedIn.body.must_change_password).toBe(true);
    });

    it('resets passwords and disables/enables, ending sessions', async () => {
      const user = await createTestUser('someone');
      const reset = await request(app).post(`/api/v1/admin/users/${user.id}/reset-password`).send({ password: 'brand-new-pass' });
      expect(reset.body.must_change_password).toBe(true);
      expect((await request(app).get('/api/v1/auth/me').set('Cookie', user.cookie)).status).toBe(401);
      expect((await login('someone', 'brand-new-pass')).status).toBe(200);

      await request(app).post(`/api/v1/admin/users/${user.id}/disable`).expect(200);
      expect((await login('someone', 'brand-new-pass')).status).toBe(403);
      await request(app).post(`/api/v1/admin/users/${user.id}/enable`).expect(200);
      expect((await login('someone', 'brand-new-pass')).status).toBe(200);
    });

    it('cannot act on its own account', async () => {
      expect((await request(app).post(`/api/v1/admin/users/${DEFAULT_USER_ID}/disable`)).status).toBe(400);
      expect((await request(app).delete(`/api/v1/admin/users/${DEFAULT_USER_ID}`).send({ confirm_username: 'default' })).status).toBe(400);
    });

    it('hard-deletes a user and their data only after confirming the username', async () => {
      const user = await createTestUser('leaving');
      const venue = await query(
        `INSERT INTO venues (name, latitude, longitude, created_by) VALUES ('Shared Cafe', 1, 2, $1) RETURNING id`,
        [user.id]
      );
      await query(`INSERT INTO checkins (user_id, venue_id, checked_in_at) VALUES ($1, $2, NOW())`, [user.id, venue.rows[0].id]);
      await query(`INSERT INTO checkins (user_id, venue_id, checked_in_at) VALUES ($1, $2, NOW())`, [DEFAULT_USER_ID, venue.rows[0].id]);

      expect((await request(app).delete(`/api/v1/admin/users/${user.id}`).send({ confirm_username: 'nope' })).status).toBe(400);
      await request(app).delete(`/api/v1/admin/users/${user.id}`).send({ confirm_username: 'leaving' }).expect(204);

      expect((await query('SELECT 1 FROM users WHERE id = $1', [user.id])).rowCount).toBe(0);
      expect((await query('SELECT 1 FROM checkins WHERE user_id = $1', [user.id])).rowCount).toBe(0);
      expect((await query('SELECT created_by FROM venues WHERE id = $1', [venue.rows[0].id])).rows[0].created_by).toBeNull();
      expect((await query('SELECT 1 FROM checkins WHERE user_id = $1', [DEFAULT_USER_ID])).rowCount).toBe(1);
    });
  });

  describe('user context', () => {
    it('survives multer when wrapped with preserveUserContext', async () => {
      const probe = express();
      const upload = multer({ storage: multer.memoryStorage() }).single('file');
      probe.use(requireAuth);
      probe.post('/wrapped', preserveUserContext(upload), (_req, res) => {
        res.json({ userId: currentUserId() });
      });
      const res = await request(probe).post('/wrapped').attach('file', Buffer.from('hello'), 'a.txt');
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(DEFAULT_USER_ID);
    });
  });
});
