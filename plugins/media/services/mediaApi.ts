// ============================================================================
// Shared in-memory TTL cache with single-flight deduplication for external
// media APIs (TMDB, TGDB, Hardcover). Prevents overloading external services:
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

export class ApiCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, InFlight>();

  constructor(private readonly ttlMs: number = DEFAULT_CACHE_TTL_MS) {}

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
        this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
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

/**
 * Perform an authenticated external API GET and parse the JSON body.
 * Throws on network failure or non-2xx status (caller decides on fallback).
 */
export async function externalFetchJson<T = unknown>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new MediaApiError(`External API returned ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new MediaApiError(`External API returned ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}
