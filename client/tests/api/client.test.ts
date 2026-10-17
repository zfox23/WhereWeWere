import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { request } from '../../src/api/client';

function mockFetchResponse(body: unknown, init: Partial<Response> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? '',
    json: async () => body,
    ...init,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api client request()', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces the server `error` message on failed responses', async () => {
    mockFetchResponse({ error: 'Failed to search media' }, { ok: false, status: 500 });

    await expect(request('/media/search')).rejects.toThrow('Failed to search media');
  });

  it('falls back to `message` when the body has no `error` field', async () => {
    mockFetchResponse({ message: 'Something went wrong' }, { ok: false, status: 502 });

    await expect(request('/checkins')).rejects.toThrow('Something went wrong');
  });

  it('falls back to statusText for non-JSON error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => {
          throw new Error('not json');
        },
      })
    );

    await expect(request('/checkins')).rejects.toThrow('Service Unavailable');
  });

  it('resolves the JSON body for successful responses', async () => {
    mockFetchResponse({ hello: 'world' });

    await expect(request('/anything')).resolves.toEqual({ hello: 'world' });
  });
});

describe('api client request() edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves undefined for a 204 instead of throwing on res.json()', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(request<void>('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('keeps Content-Type when the caller passes its own headers', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await request('/x', { method: 'POST', headers: { 'X-Custom': '1' }, body: '{}' });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Custom': '1' });
  });
});
