/**
 * The original single user's id ('zach', seeded by migration 002).
 *
 * WhereWeWere was single-user before accounts existed; every pre-existing
 * row belongs to this id, and migration 073 makes it the instance admin.
 *
 * Used ONLY by migrations and tests. Runtime code must never act as this
 * user implicitly: take the user from `currentUserId()` (server/src/auth/
 * context.ts), which throws outside an authenticated request or `runAsUser`.
 */
export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';
