/**
 * Produce a URL-safe slug from a title.
 * "The Lord of the Rings" -> "the-lord-of-the-rings"
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Local device time zone, e.g. "America/New_York". */
export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Format the current local date/time for a <input type="datetime-local">.
 */
export function nowLocalDatetimeValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Convert a datetime-local value to an ISO string using the local timezone offset.
 * The browser interprets the value as local time; we serialize with the offset
 * so the server stores the correct absolute instant.
 */
export function localDatetimeToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
