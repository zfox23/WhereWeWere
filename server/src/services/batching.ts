/**
 * Helpers for endpoints that fan a batch of check-in ids out to upstream
 * services (Immich, Maloja).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Largest id batch the fan-out endpoints will process in one request. */
export const MAX_CHECKIN_ID_BATCH = 100;

/**
 * Parse a comma-separated `checkin_ids` query value into unique, valid UUIDs,
 * capped at `max`. Invalid entries are dropped instead of poisoning the whole
 * batch (a non-UUID makes `ANY($1::uuid[])` throw, which used to 500 it all).
 */
export function parseCheckinIdList(raw: unknown, max = MAX_CHECKIN_ID_BATCH): string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (UUID_RE.test(id)) seen.add(id.toLowerCase());
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
