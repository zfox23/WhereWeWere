/**
 * Tiny pub/sub between the API helpers and the AuthProvider: a request that
 * comes back "not signed in" (401 unauthenticated) or "temporary password"
 * (403 password_change_required) is reported here, and the auth gate drops
 * to the login / choose-a-new-password screen. Kept separate from the
 * context so api/client.ts doesn't import React code.
 */
export type AuthFailure = 'unauthenticated' | 'password_change_required';

const target = new EventTarget();
const EVENT = 'wwp:auth-failure';

/** Inspect a failed response's status + error `code` and report session problems. */
export function reportAuthFailure(status: number, code: unknown): void {
  let kind: AuthFailure | null = null;
  if (status === 401 && code === 'unauthenticated') kind = 'unauthenticated';
  else if (status === 403 && code === 'password_change_required') kind = 'password_change_required';
  if (kind) target.dispatchEvent(new CustomEvent<AuthFailure>(EVENT, { detail: kind }));
}

/** Subscribe to auth failures; returns the unsubscribe function. */
export function onAuthFailure(listener: (kind: AuthFailure) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AuthFailure>).detail);
  target.addEventListener(EVENT, handler);
  return () => target.removeEventListener(EVENT, handler);
}
