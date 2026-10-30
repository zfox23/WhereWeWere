/**
 * Integration-test sign-in helpers.
 *
 * `resetIntegrationDatabase` gives the default user a known session, and the
 * setup file (integrationEnv.ts) makes every `request(app).<verb>()` send its
 * cookie, so existing suites run as the default user unchanged. To act as
 * someone else, `.set('Cookie', other.cookie)`; to act anonymously,
 * `.unset('Cookie')`.
 */

import crypto from 'crypto';
import { query } from '../../src/db';
import { hashPassword } from '../../src/auth/passwords';
import { SESSION_COOKIE } from '../../src/auth/sessions';

export const DEFAULT_SESSION_TOKEN = 'integration-test-default-session-token';
export const DEFAULT_SESSION_COOKIE = `${SESSION_COOKIE}=${DEFAULT_SESSION_TOKEN}`;

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Insert a live session for `userId` and return its Cookie header value. */
export async function createTestSession(userId: string, token = crypto.randomBytes(24).toString('base64url')) {
  await query(
    `INSERT INTO sessions (token_hash, user_id, remember, expires_at)
     VALUES ($1, $2, TRUE, NOW() + INTERVAL '1 day')`,
    [sha256(token), userId]
  );
  return `${SESSION_COOKIE}=${token}`;
}

export interface TestUser {
  id: string;
  username: string;
  password: string;
  cookie: string;
}

/** Create a signed-in (non-admin unless asked) user for isolation tests. */
export async function createTestUser(
  username: string,
  { isAdmin = false, password = 'test-password-1' }: { isAdmin?: boolean; password?: string } = {}
): Promise<TestUser> {
  const result = await query(
    `INSERT INTO users (username, password_hash, display_name, is_admin)
     VALUES ($1, $2, $1, $3) RETURNING id`,
    [username, await hashPassword(password), isAdmin]
  );
  const id = result.rows[0].id as string;
  return { id, username, password, cookie: await createTestSession(id) };
}
