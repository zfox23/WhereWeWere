/** Account field rules, shared by the auth routes, admin routes, and CLI. */

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,30}$/;
export const PASSWORD_MIN_LENGTH = 8;
/** scrypt is happy with long input, but don't hash megabytes. */
export const PASSWORD_MAX_LENGTH = 256;
export const DISPLAY_NAME_MAX_LENGTH = 100;

/** Error message for an invalid username, or null when it's fine. */
export function usernameError(username: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3–30 characters: letters, numbers, _ . -';
  }
  return null;
}

export function passwordError(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  return null;
}

/** Normalized display name (trimmed, empty → null), or an error. */
export function parseDisplayName(value: unknown): { value: string | null } | { error: string } {
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== 'string') return { error: 'Display name must be a string' };
  const trimmed = value.trim();
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return { error: `Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters` };
  }
  return { value: trimmed || null };
}

/** Postgres unique violation on the username (case-insensitive) index. */
export function isUsernameTaken(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' && (e.constraint === 'users_username_lower_key' || e.constraint === 'users_username_key');
}
