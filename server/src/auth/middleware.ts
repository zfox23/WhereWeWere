/**
 * Request guards.
 *
 * `authenticate` resolves the session cookie into `req.auth` and runs the rest
 * of the request as that user (see context.ts). `requireAuth` additionally
 * blocks everything except the auth routes while the user still has to
 * replace a temporary password. `requireAdmin` gates the user-management API.
 * `webhookUser` authenticates inbound webhooks by the secret token in their URL.
 */

import type { NextFunction, Request, Response } from 'express';
import { query } from '../db';
import { runAsUser } from './context';
import {
  clearSessionCookie,
  findSession,
  readSessionToken,
  touchSession,
  type SessionInfo,
  type SessionUser,
} from './sessions';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { user: SessionUser; session: SessionInfo };
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readSessionToken(req);
  const found = token ? await findSession(token) : null;
  if (!token || !found) {
    if (token) clearSessionCookie(req, res);
    res.status(401).json({ error: 'Not signed in', code: 'unauthenticated' });
    return;
  }
  await touchSession(req, res, token, found.session);
  req.auth = found;
  runAsUser(found.user.id, () => next());
}

export function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  return authenticate(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (req.auth!.user.must_change_password) {
      res.status(403).json({ error: 'You must change your password first', code: 'password_change_required' });
      return;
    }
    next();
  });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.user.is_admin) {
    res.status(403).json({ error: 'Admin only' });
    return;
  }
  next();
}

/**
 * For webhook routes declared as `/:token`: run the handler as the user whose
 * webhook_token matches, or 404 (indistinguishable from a wrong URL).
 */
export async function webhookUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.params.token;
  const result = typeof token === 'string' && token.length > 0
    ? await query('SELECT id FROM users WHERE webhook_token = $1 AND disabled_at IS NULL', [token])
    : null;
  const userId: string | undefined = result?.rows[0]?.id;
  if (!userId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  runAsUser(userId, () => next());
}
