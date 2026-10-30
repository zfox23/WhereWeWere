/**
 * Set a user's password from the server shell — the recovery path when no
 * admin can sign in (there is no email reset).
 *
 *   npm run user:set-password --workspace=server -- <username> [--generate] [--keep]
 *   docker compose exec server node dist/server/src/scripts/set-password.js <username> --generate
 *
 * Without --generate the password is read from stdin (one line). The user
 * must replace it at next sign-in unless --keep is given. Every existing
 * session of the user is ended.
 */

import crypto from 'crypto';
import readline from 'readline';
import { pool, query } from '../db';
import { hashPassword } from '../auth/passwords';
import { deleteUserSessions } from '../auth/sessions';
import { passwordError } from '../auth/validation';

function generatePassword(): string {
  // 15 random bytes → 20 base64url chars (~120 bits).
  return crypto.randomBytes(15).toString('base64url');
}

async function readLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await new Promise((resolve) => rl.question(prompt, resolve));
  } finally {
    rl.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const username = args.find((a) => !a.startsWith('--'));
  if (!username) {
    console.error('Usage: set-password <username> [--generate] [--keep]');
    process.exit(2);
  }

  const found = await query('SELECT id, username FROM users WHERE lower(username) = lower($1)', [username]);
  const user = found.rows[0];
  if (!user) {
    console.error(`No user named "${username}"`);
    process.exit(1);
  }

  const generated = args.includes('--generate');
  const password = generated ? generatePassword() : await readLine('New password: ');
  const invalid = passwordError(password);
  if (invalid) {
    console.error(invalid);
    process.exit(1);
  }

  const mustChange = !args.includes('--keep');
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = $3, password_changed_at = NOW()
     WHERE id = $1`,
    [user.id, await hashPassword(password), mustChange]
  );
  await deleteUserSessions(user.id);

  console.log(`Password set for ${user.username}.${mustChange ? ' They must change it at next sign-in.' : ''}`);
  if (generated) console.log(`Password: ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
