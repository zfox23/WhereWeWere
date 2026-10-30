/**
 * /api/v1/admin/users — account management for admins.
 *
 * Admins manage accounts only; nothing here exposes another user's data.
 * Without email, an admin password reset is the account recovery path (the
 * CLI `user:set-password` covers locked-out admins).
 */

import { Router, Request, Response } from 'express';
import { query } from '../db';
import { requireAdmin } from '../auth/middleware';
import { hashPassword } from '../auth/passwords';
import { deleteUserSessions } from '../auth/sessions';
import { isUsernameTaken, parseDisplayName, passwordError, usernameError } from '../auth/validation';
import { deleteUserAccount } from '../services/accountDeletion';

const router = Router();
router.use(requireAdmin);

const USER_COLUMNS = `u.id, u.username, u.display_name, u.is_admin, u.disabled_at,
  u.must_change_password, u.created_at,
  (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at`;

async function loadUser(id: string) {
  const result = await query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id::text = $1`, [id]);
  return result.rows[0] ?? null;
}

// GET / - every account
router.get('/', async (_req: Request, res: Response) => {
  const result = await query(`SELECT ${USER_COLUMNS} FROM users u ORDER BY lower(u.username)`);
  res.json(result.rows);
});

// POST / - { username, password, display_name?, is_admin? }. The new user must
// replace the password on first sign-in.
router.post('/', async (req: Request, res: Response) => {
  const { username, password, is_admin } = req.body ?? {};
  const invalid = usernameError(username) ?? passwordError(password);
  if (invalid) return res.status(400).json({ error: invalid });
  const displayName = parseDisplayName(req.body?.display_name);
  if ('error' in displayName) return res.status(400).json({ error: displayName.error });

  try {
    const result = await query(
      `INSERT INTO users (username, password_hash, display_name, is_admin, must_change_password)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id`,
      [username, await hashPassword(password), displayName.value, is_admin === true]
    );
    res.status(201).json(await loadUser(result.rows[0].id));
  } catch (err) {
    if (isUsernameTaken(err)) return res.status(409).json({ error: 'That username is taken' });
    throw err;
  }
});

/** Resolve :id, refusing to act on the admin's own account. */
async function otherUser(req: Request, res: Response): Promise<{ id: string; username: string } | null> {
  const user = await loadUser(String(req.params.id));
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return null;
  }
  if (user.id === req.auth!.user.id) {
    res.status(400).json({ error: 'Use your own Account settings for your account' });
    return null;
  }
  return user;
}

// POST /:id/reset-password - { password }. Signs the user out everywhere and
// makes them choose a new password on next sign-in.
router.post('/:id/reset-password', async (req: Request, res: Response) => {
  const invalid = passwordError(req.body?.password);
  if (invalid) return res.status(400).json({ error: invalid });
  const user = await otherUser(req, res);
  if (!user) return;

  await query(
    `UPDATE users SET password_hash = $2, must_change_password = TRUE, password_changed_at = NOW()
     WHERE id = $1`,
    [user.id, await hashPassword(req.body.password)]
  );
  await deleteUserSessions(user.id);
  res.json(await loadUser(user.id));
});

// PUT /:id/admin - { is_admin }
router.put('/:id/admin', async (req: Request, res: Response) => {
  if (typeof req.body?.is_admin !== 'boolean') {
    return res.status(400).json({ error: 'is_admin must be a boolean' });
  }
  const user = await otherUser(req, res);
  if (!user) return;
  await query('UPDATE users SET is_admin = $2 WHERE id = $1', [user.id, req.body.is_admin]);
  res.json(await loadUser(user.id));
});

// POST /:id/disable - block sign-in and end sessions; data is kept
router.post('/:id/disable', async (req: Request, res: Response) => {
  const user = await otherUser(req, res);
  if (!user) return;
  await query('UPDATE users SET disabled_at = COALESCE(disabled_at, NOW()) WHERE id = $1', [user.id]);
  await deleteUserSessions(user.id);
  res.json(await loadUser(user.id));
});

// POST /:id/enable
router.post('/:id/enable', async (req: Request, res: Response) => {
  const user = await otherUser(req, res);
  if (!user) return;
  await query('UPDATE users SET disabled_at = NULL WHERE id = $1', [user.id]);
  res.json(await loadUser(user.id));
});

// DELETE /:id - { confirm_username }. Permanently deletes the account and all
// of its data. Shared venues it created are kept.
router.delete('/:id', async (req: Request, res: Response) => {
  const user = await otherUser(req, res);
  if (!user) return;
  if (req.body?.confirm_username !== user.username) {
    return res.status(400).json({ error: 'Type the username to confirm deletion' });
  }
  await deleteUserAccount(user.id);
  res.status(204).end();
});

export const usersRouter = router;
