// Shared `--user <username>` handling for plugin CLI scripts: every script
// works on exactly one account's data, named on the command line.

import { pool } from '../db';

export interface ScriptUser {
  id: string;
  username: string;
}

/**
 * Pull `--user <name>` (or `--user=<name>`) out of `args`, returning the
 * username and the remaining arguments. Null username when the flag is absent.
 */
export function takeUserArg(args: string[]): { username: string | null; rest: string[] } {
  const rest: string[] = [];
  let username: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--user') {
      username = args[i + 1] ?? '';
      i++;
    } else if (arg.startsWith('--user=')) {
      username = arg.slice('--user='.length);
    } else {
      rest.push(arg);
    }
  }
  return { username, rest };
}

/** Look up a user by username, case-insensitively. Null when there is none. */
export async function findScriptUser(username: string): Promise<ScriptUser | null> {
  const res = await pool.query(
    'SELECT id, username FROM users WHERE lower(username) = lower($1)',
    [username.trim()]
  );
  return res.rows[0] ? { id: res.rows[0].id as string, username: res.rows[0].username as string } : null;
}

/**
 * Resolve the `--user` flag, or print `usage` and exit non-zero when it is
 * missing or names no account.
 */
export async function requireScriptUser(args: string[], usage: string): Promise<{ user: ScriptUser; rest: string[] }> {
  const { username, rest } = takeUserArg(args);
  if (!username || !username.trim()) {
    console.error(`--user <username> is required.\n${usage}`);
    await pool.end();
    process.exit(1);
  }
  const user = await findScriptUser(username);
  if (!user) {
    console.error(`No user named "${username}".`);
    await pool.end();
    process.exit(1);
  }
  return { user, rest };
}
