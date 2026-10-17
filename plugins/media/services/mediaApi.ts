// ============================================================================
// Shared in-memory TTL cache with single-flight deduplication for external
// media APIs (TMDB, IGDB, Hardcover). Prevents overloading external services:
//   - Identical requests made within the TTL window are served from memory.
//   - Concurrent identical requests coalesce into a single network call.
//   - All external lookups are skipped entirely when the local DB already has
//     the entity (see the search merge in routes/media.ts).
// ============================================================================

export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

interface InFlight {
  promise: Promise<unknown>;
}

/** Upper bound on cached responses per ApiCache (keys are arbitrary search strings). */
export const DEFAULT_CACHE_MAX_ENTRIES = 500;

export class ApiCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, InFlight>();

  constructor(
    private readonly ttlMs: number = DEFAULT_CACHE_TTL_MS,
    private readonly maxEntries: number = DEFAULT_CACHE_MAX_ENTRIES
  ) {}

  /** Number of cached (not in-flight) entries; exposed for tests. */
  get size(): number {
    return this.cache.size;
  }

  private store(key: string, value: unknown): void {
    // Re-inserting moves the key to the end, so Map order is least-recently-stored first.
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.cache.size <= this.maxEntries) return;

    // Over the cap: drop expired entries first, then the oldest ones.
    const now = Date.now();
    for (const [k, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(k);
    }
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  /**
   * Return the cached value for `key`, or fetch it via `loader`.
   * Concurrent calls with the same key share a single in-flight request.
   */
  async get<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as T;
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing.promise as Promise<T>;
    }

    const promise = loader().then(
      (value) => {
        this.store(key, value);
        this.inflight.delete(key);
        return value;
      },
      (err) => {
        this.inflight.delete(key);
        throw err;
      }
    );

    this.inflight.set(key, { promise: promise as Promise<unknown> });
    return promise;
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}

export class MediaApiError extends Error {}

/**
 * Wraps an external API response in a graceful-degradation boundary:
 * network errors, non-2xx status codes, and missing API keys all resolve to
 * `fallback` instead of failing the request.
 */
export async function withDegradation<T>(
  fetcher: () => Promise<T>,
  fallback: T,
  label: string
): Promise<T> {
  try {
    return await fetcher();
  } catch (err) {
    console.warn(`[media-api] ${label} failed, serving fallback:`, err);
    return fallback;
  }
}

/** Longest we will wait on a Retry-After before giving up on a rate-limited call. */
const MAX_RETRY_WAIT_MS = 5_000;
const EXTERNAL_TIMEOUT_MS = 15_000;

function retryDelayMs(res: Response): number {
  const header = res.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  const ms = Number.isFinite(seconds) ? seconds * 1000 : 1_000;
  return Math.min(Math.max(ms, 250), MAX_RETRY_WAIT_MS);
}

/**
 * fetch() with a per-attempt timeout and one retry when the provider answers
 * 429 (rate limited) or 503, honoring Retry-After up to a short cap. Anything
 * else (including a second 429) is returned for the caller to treat as an
 * error, so searches still degrade gracefully instead of hanging.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      const wait = retryDelayMs(res);
      await res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return res;
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new MediaApiError(`External API returned ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Perform an authenticated external API GET and parse the JSON body.
 * Throws on network failure or non-2xx status (caller decides on fallback).
 */
export async function externalFetchJson<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return parseJsonOrThrow<T>(await fetchWithRetry(url, { headers }));
}

/**
 * Perform an external API POST with a plain-text body and parse the JSON
 * response. Used by IGDB, which takes an APICalypse query as a text/plain
 * body rather than JSON. Throws on network failure or non-2xx status
 * (caller decides on fallback).
 */
export async function externalFetchPostText<T = unknown>(
  url: string,
  textBody: string,
  headers: Record<string, string> = {}
): Promise<T> {
  return parseJsonOrThrow<T>(
    await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', ...headers },
      body: textBody,
    })
  );
}

/**
 * Perform an external API POST with a JSON body and parse the JSON response.
 * Throws on network failure or non-2xx status (caller decides on fallback).
 */
export async function externalFetchPostJson<T = unknown>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<T> {
  return parseJsonOrThrow<T>(
    await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  );
}
