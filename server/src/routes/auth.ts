/**
 * /api/v1/auth — sign in/out and the signed-in user's own account.
 *
 * Mounted before the global `requireAuth` guard: /login is public, the rest
 * use `authenticate` so a user with a temporary password can still reach
 * /me, /password, and /logout.
 */

import { Router, Request, Response } from 'express';
import { query } from '../db';
import { authenticate, requireAuth } from '../auth/middleware';
import { getDummyHash, hashPassword, verifyPassword } from '../auth/passwords';
import { loginRetryAfter, recordLoginFailure, recordLoginSuccess } from '../auth/rateLimit';
import {
  clearSessionCookie,
  createSession,
  deleteSessionByToken,
  deleteUserSessions,
  purgeExpiredSessions,
  readSessionToken,
  setSessionCookie,
} from '../auth/sessions';
import { isUsernameTaken, parseDisplayName, passwordError, usernameError } from '../auth/validation';

const router = Router();

const INVALID_LOGIN = 'Invalid username or password';

// POST /login - { username, password, remember }
router.post('/login', async (req: Request, res: Response) => {
  const { username, password, remember } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const ip = req.ip ?? 'unknown';
  const retryAfter = loginRetryAfter(ip, username);
  if (retryAfter > 0) {
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  }

  const result = await query(
    `SELECT id, username, password_hash, disabled_at FROM users WHERE lower(username) = lower($1)`,
    [username]
  );
  const user = result.rows[0];
  // Hash even for unknown usernames so response time doesn't reveal which exist.
  const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
  if (!user || !ok) {
    recordLoginFailure(ip, username);
    return res.status(401).json({ error: INVALID_LOGIN });
  }
  if (user.disabled_at) {
    return res.status(403).json({ error: 'This account is disabled' });
  }

  recordLoginSuccess(username);
  const token = await createSession(req, user.id, remember === true);
  setSessionCookie(req, res, token, remember === true);
  // Opportunistic cleanup; logins are rare enough that this is cheap.
  purgeExpiredSessions().catch((err) => console.error('Failed to purge expired sessions:', err));
  res.json(await loadAccount(user.id));
});

// POST /logout - end this session (always succeeds)
router.post('/logout', async (req: Request, res: Response) => {
  const token = readSessionToken(req);
  if (token) await deleteSessionByToken(token);
  clearSessionCookie(req, res);
  res.status(204).end();
});

router.use(authenticate);

async function loadAccount(userId: string) {
  const result = await query(
    `SELECT id, username, display_name, is_admin, must_change_password, created_at
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0];
}

// GET /me - the signed-in account
router.get('/me', async (req: Request, res: Response) => {
  res.json(await loadAccount(req.auth!.user.id));
});

// PUT /password - { current_password, new_password }. Ends every other session.
router.put('/password', async (req: Request, res: Response) => {
  const { current_password, new_password } = req.body ?? {};
  const invalid = passwordError(new_password);
  if (invalid) return res.status(400).json({ error: invalid });
  if (typeof current_password !== 'string') {
    return res.status(400).json({ error: 'Current password is required' });
  }

  const userId = req.auth!.user.id;
  const current = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!(await verifyPassword(current_password, current.rows[0].password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (current_password === new_password) {
    return res.status(400).json({ error: 'New password must be different from the current one' });
  }

  await query(
    `UPDATE users
     SET password_hash = $2, must_change_password = FALSE, password_changed_at = NOW()
     WHERE id = $1`,
    [userId, await hashPassword(new_password)]
  );
  await deleteUserSessions(userId, req.auth!.session.id);
  res.json(await loadAccount(userId));
});

// Everything below needs a non-temporary password.
router.use(requireAuth);

// PUT /profile - { username?, display_name? }
router.put('/profile', async (req: Request, res: Response) => {
  const { username } = req.body ?? {};
  if (username !== undefined) {
    const invalid = usernameError(username);
    if (invalid) return res.status(400).json({ error: invalid });
  }
  const hasDisplayName = req.body && 'display_name' in req.body;
  const displayName = parseDisplayName(req.body?.display_name);
  if ('error' in displayName) return res.status(400).json({ error: displayName.error });

  try {
    await query(
      `UPDATE users
       SET username = COALESCE($2, username),
           display_name = CASE WHEN $3 THEN $4 ELSE display_name END
       WHERE id = $1`,
      [req.auth!.user.id, username ?? null, hasDisplayName, displayName.value]
    );
  } catch (err) {
    if (isUsernameTaken(err)) return res.status(409).json({ error: 'That username is taken' });
    throw err;
  }
  res.json(await loadAccount(req.auth!.user.id));
});

// GET /sessions - this account's signed-in devices
router.get('/sessions', async (req: Request, res: Response) => {
  const result = await query(
    `SELECT id, remember, user_agent, ip, created_at, last_seen_at, expires_at
     FROM sessions
     WHERE user_id = $1 AND expires_at > NOW()
     ORDER BY last_seen_at DESC`,
    [req.auth!.user.id]
  );
  res.json(result.rows.map((row) => ({ ...row, current: row.id === req.auth!.session.id })));
});

// DELETE /sessions/:id - sign out one device
router.delete('/sessions/:id', async (req: Request, res: Response) => {
  const result = await query(
    'DELETE FROM sessions WHERE id::text = $1 AND user_id = $2',
    [req.params.id, req.auth!.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
  if (req.params.id === req.auth!.session.id) clearSessionCookie(req, res);
  res.status(204).end();
});

// POST /sessions/sign-out-everywhere - every device, including this one
router.post('/sessions/sign-out-everywhere', async (req: Request, res: Response) => {
  await deleteUserSessions(req.auth!.user.id);
  clearSessionCookie(req, res);
  res.status(204).end();
});

// GET /webhook-token - secret path segment for this account's inbound webhooks
router.get('/webhook-token', async (req: Request, res: Response) => {
  const result = await query('SELECT webhook_token FROM users WHERE id = $1', [req.auth!.user.id]);
  res.json({ token: result.rows[0].webhook_token });
});

// POST /webhook-token/regenerate - invalidates every configured webhook URL
router.post('/webhook-token/regenerate', async (req: Request, res: Response) => {
  const result = await query(
    `UPDATE users
     SET webhook_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
     WHERE id = $1
     RETURNING webhook_token`,
    [req.auth!.user.id]
  );
  res.json({ token: result.rows[0].webhook_token });
});

export const authRouter = router;
