import { describe, expect, it, vi } from 'vitest';
import { ApiCache, withDegradation, MediaApiError, externalFetchJson } from '../../src/services/mediaApi';

describe('ApiCache', () => {
  it('caches values for the TTL window', async () => {
    const cache = new ApiCache(60_000);
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };

    const first = await cache.get('k', loader);
    const second = await cache.get('k', loader);

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(calls).toBe(1);
  });

  it('refetches after the TTL expires', async () => {
    const cache = new ApiCache(1);
    let calls = 0;
    const loader = async () => ++calls;

    await cache.get('k', loader);
    await new Promise((r) => setTimeout(r, 5));
    await cache.get('k', loader);

    expect(calls).toBe(2);
  });

  it('coalesces concurrent requests into a single fetch', async () => {
    const cache = new ApiCache(60_000);
    let calls = 0;
    const loader = () =>
      new Promise<number>((resolve) =>
        setTimeout(() => {
          calls += 1;
          resolve(calls);
        }, 5)
      );

    const [a, b, c] = await Promise.all([
      cache.get('k', loader),
      cache.get('k', loader),
      cache.get('k', loader),
    ]);

    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(c).toBe(1);
    expect(calls).toBe(1);
  });

  it('does not cache rejected loads and retries them', async () => {
    const cache = new ApiCache(60_000);
    const boom = () => Promise.reject(new Error('down'));

    await expect(cache.get('k', boom)).rejects.toThrow('down');

    const ok = async () => 42;
    await expect(cache.get('k', ok)).resolves.toBe(42);
  });

  it('clear() drops all entries and in-flight trackers', async () => {
    const cache = new ApiCache(60_000);
    let calls = 0;
    const loader = async () => ++calls;

    await cache.get('k', loader);
    cache.clear();
    await cache.get('k', loader);

    expect(calls).toBe(2);
  });
});

describe('withDegradation', () => {
  it('returns the fetcher value on success', async () => {
    await expect(withDegradation(async () => 'data', 'fallback', 'test')).resolves.toBe('data');
  });

  it('returns the fallback when the fetcher throws', async () => {
    const spy = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(withDegradation(spy, 'fallback', 'test')).resolves.toBe('fallback');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('externalFetchJson', () => {
  it('parses JSON from a 2xx response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const data = await externalFetchJson<{ ok: number }>('https://example.com/x');

    expect(data).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('throws MediaApiError on non-2xx responses', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(externalFetchJson('https://example.com/x')).rejects.toBeInstanceOf(MediaApiError);
    vi.unstubAllGlobals();
  });

  it('throws on network failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(externalFetchJson('https://example.com/x')).rejects.toThrow('fetch failed');
    vi.unstubAllGlobals();
  });
});
