/**
 * The single-user id used across WhereWeWere.
 *
 * The app is single-user per instance; this UUID is seeded by
 * migration 002 and referenced by routes, services, and plugins.
 * Import this constant instead of re-declaring the literal.
 */
export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';
