/**
 * Lets a plugin hold back a sign-out that would lose something the user
 * hasn't saved (e.g. audio recordings that haven't finished uploading).
 * A guard resolves true to allow the sign-out, false to cancel it; it may
 * ask the user. The signed-in account's id is passed so a guard only
 * considers that account's data.
 */

export type SignOutGuard = (userId: string) => Promise<boolean>;

const guards = new Set<SignOutGuard>();

export function registerSignOutGuard(guard: SignOutGuard): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}

/** True when every guard allows signing out. A guard that throws doesn't block it. */
export async function runSignOutGuards(userId: string): Promise<boolean> {
  for (const guard of guards) {
    try {
      if (!(await guard(userId))) return false;
    } catch {
      // a broken guard must never trap the user signed in
    }
  }
  return true;
}
