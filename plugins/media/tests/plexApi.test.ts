import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { plexWebhook } from '../ui/api';

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

describe('plexWebhook.stats', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the Plex webhook stats endpoint', async () => {
    const fetchMock = mockFetchResponse({ count: 3 });

    await expect(plexWebhook.stats()).resolves.toEqual({ count: 3 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/webhook/plex/stats',
      expect.objectContaining({ headers: expect.anything() })
    );
  });
});
