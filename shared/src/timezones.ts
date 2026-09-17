/**
 * IANA timezone helpers shared by client and server. Uses the standard
 * `Intl.DateTimeFormat` API, which is available in both environments.
 */

/** True when `timeZone` is a valid IANA timezone identifier (e.g. 'America/New_York'). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
