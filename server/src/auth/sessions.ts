/**
 * Cookie-backed login sessions stored in Postgres (so restarts and redeploys
 * don't sign anyone out).
 *
 * - "Remember me": persistent cookie, 30 days sliding; each use renews it.
 * - Otherwise: browser-session cookie (gone when the browser closes), and the
 *   server also expires it after 12 idle hours.
 *
 * The cookie holds a random token; the database holds only its SHA-256.
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { query } from '../db';

export const SESSION_COOKIE = 'wherewewere_session';
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
/** Renew at most this often, so every request isn't a write. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionUser {
  id: string;
  username: string;
  display_name: string | null;
  is_admin: boolean;
  must_change_password: boolean;
}

export interface SessionInfo {
  id: string;
  remember: boolean;
  last_seen_at: Date;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function lifetimeMs(remember: boolean): number {
  return remember ? REMEMBER_MS : SESSION_IDLE_MS;
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim();
      return value || null;
    }
  }
  return null;
}

export function setSessionCookie(req: Request, res: Response, token: string, remember: boolean): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    ...(remember ? { maxAge: REMEMBER_MS } : {}),
  });
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
}

export async function createSession(req: Request, userId: string, remember: boolean): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO sessions (token_hash, user_id, remember, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(secs => $6))`,
    [
      hashToken(token),
      userId,
      remember,
      req.get('user-agent')?.slice(0, 500) ?? null,
      req.ip ?? null,
      lifetimeMs(remember) / 1000,
    ]
  );
  return token;
}

/** Look up a live session and its (enabled) user. */
export async function findSession(token: string): Promise<{ user: SessionUser; session: SessionInfo } | null> {
  const result = await query(
    `SELECT s.id AS session_id, s.remember, s.last_seen_at,
            u.id, u.username, u.display_name, u.is_admin, u.must_change_password
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
       AND u.disabled_at IS NULL`,
    [hashToken(token)]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    user: {
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      is_admin: row.is_admin,
      must_change_password: row.must_change_password,
    },
    session: { id: row.session_id, remember: row.remember, last_seen_at: row.last_seen_at },
  };
}

/**
 * Slide the session's expiry forward (and re-issue a remembered cookie) when
 * it was last renewed more than TOUCH_INTERVAL_MS ago.
 */
export async function touchSession(
  req: Request,
  res: Response,
  token: string,
  session: SessionInfo
): Promise<void> {
  if (Date.now() - new Date(session.last_seen_at).getTime() < TOUCH_INTERVAL_MS) return;
  await query(
    `UPDATE sessions
     SET last_seen_at = NOW(), expires_at = NOW() + make_interval(secs => $2), ip = $3
     WHERE id = $1`,
    [session.id, lifetimeMs(session.remember) / 1000, req.ip ?? null]
  );
  if (session.remember) setSessionCookie(req, res, token, true);
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

/** End every session of a user, optionally keeping one (the caller's own). */
export async function deleteUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const result = await query(
    `DELETE FROM sessions WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, exceptSessionId ?? null]
  );
  return result.rowCount ?? 0;
}

export async function purgeExpiredSessions(): Promise<void> {
  await query('DELETE FROM sessions WHERE expires_at <= NOW()');
}
