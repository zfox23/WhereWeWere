import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CoasterpediaError,
  coasterpediaUserAgent,
  getAttraction,
  parseAttractionId,
  pickMatch,
  searchAttractions,
} from '../services/coasterpedia';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function problem(type: string, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ type: `https://api.coasterpedia.net/problems/${type}`, title: type, status }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseAttractionId', () => {
  it('accepts a bare ID and Coasterpedia/API URLs', () => {
    expect(parseAttractionId(' 165 ')).toBe(165);
    expect(parseAttractionId('https://api.coasterpedia.net/v1/attractions/169')).toBe(169);
    expect(parseAttractionId('https://api.coasterpedia.net/v1/attractions/171?view=latest')).toBe(171);
  });
  it('rejects anything else', () => {
    expect(parseAttractionId('Batman The Ride')).toBeNull();
    expect(parseAttractionId('')).toBeNull();
  });
});

describe('Coasterpedia client', () => {
  it('sends the bearer key and a User-Agent, and returns the data array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 1, name: 'Batman The Ride' }] }));
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchAttractions('Batman: The Ride', 'cpk_test');

    expect(results).toEqual([{ id: 1, name: 'Batman The Ride' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.coasterpedia.net/v1/attractions?q=Batman%3A%20The%20Ride&limit=50');
    expect(init.headers.Authorization).toBe('Bearer cpk_test');
    expect(init.headers['User-Agent']).toBe(coasterpediaUserAgent());
    expect(coasterpediaUserAgent()).toMatch(/^WhereWeWere\//);
  });

  it('returns the record for one attraction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { id: 5, name: 'X', url: 'u' } })));
    expect((await getAttraction(5, 'cpk_test')).id).toBe(5);
  });

  it('maps 401 and 404 to errors carrying the status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    await expect(getAttraction(1, 'bad')).rejects.toMatchObject({ name: 'CoasterpediaError', status: 401 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    await expect(getAttraction(1, 'k')).rejects.toBeInstanceOf(CoasterpediaError);
  });

  it('tells a deleted record from one that has not settled yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(problem('not-found', 404)));
    const gone = await getAttraction(1, 'k').catch((e) => e);
    expect(gone).toMatchObject({ status: 404, problemType: 'not-found', isNotFound: true });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(problem('not-settled', 404)));
    const fresh = await getAttraction(1, 'k').catch((e) => e);
    expect(fresh.isNotFound).toBe(false);
    expect(fresh.message).toMatch(/not in the settled data yet/);
  });

  it('explains a revoked key and flags auth failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(problem('key-revoked', 403)));
    const revoked = await getAttraction(1, 'k').catch((e) => e);
    expect(revoked.message).toMatch(/revoked/);
    expect(revoked.isAuthFailure).toBe(true);

    // Cloudflare's User-Agent block is an HTML 403, not a problem document.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>blocked</html>', { status: 403, headers: { 'content-type': 'text/html' } })));
    const blocked = await getAttraction(1, 'k').catch((e) => e);
    expect(blocked.message).toMatch(/COASTERPEDIA_CONTACT/);
    expect(blocked.isAuthFailure).toBe(true);
  });

  it('waits out a long Retry-After and keeps retrying when patient', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => problem('rate-limited', 429, { 'retry-after': '40' }))
      .mockImplementationOnce(async () => problem('rate-limited', 429, { 'retry-after': '40' }))
      .mockImplementationOnce(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = searchAttractions('x y', 'k', { patient: true });
    await vi.advanceTimersByTimeAsync(80_000);
    expect(await pending).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries once after a 429 honoring Retry-After', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { 'retry-after': '1' }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = searchAttractions('x y', 'k');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after a second 429', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse({}, 429, { 'retry-after': '1' })));
    const pending = searchAttractions('x y', 'k');
    const assertion = expect(pending).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });
});

describe('pickMatch', () => {
  const a = (id: number, name: string, extra: Record<string, unknown> = {}) => ({ id, name, ...extra });

  it('is no_match for no results', () => {
    expect(pickMatch([], { name: 'Batman' })).toEqual({ status: 'no_match' });
  });

  it('accepts exactly one name match, ignoring case, accents and punctuation', () => {
    const out = pickMatch([a(1, 'Batman: The Ride'), a(2, 'Batman The Escape')], { name: 'batman the ride' });
    expect(out).toEqual({ status: 'matched', attractionId: 1 });
    expect(pickMatch([a(3, 'Élan')], { name: 'Elan' })).toEqual({ status: 'matched', attractionId: 3 });
  });

  it('leaves non-exact results for the user', () => {
    const out = pickMatch([a(1, 'Batman The Ride'), a(2, 'Batman The Escape')], { name: 'Batman' });
    expect(out.status).toBe('ambiguous');
  });

  it('narrows several same-named rides by parent park, then by country', () => {
    const results = [
      a(1, 'Boomerang', { park: { name: 'Park A' }, country: { code: 'US', name: 'USA' } }),
      a(2, 'Boomerang', { park: { name: 'Park B' }, country: { code: 'DE', name: 'Germany' } }),
      a(3, 'Boomerang', { park: { name: 'Park C' }, country: { code: 'US', name: 'USA' } }),
    ];
    expect(pickMatch(results, { name: 'Boomerang', parentName: 'park b' })).toEqual({ status: 'matched', attractionId: 2 });
    expect(pickMatch(results, { name: 'Boomerang', country: 'Germany' })).toEqual({ status: 'matched', attractionId: 2 });
    expect(pickMatch(results, { name: 'Boomerang', country: 'us' }).status).toBe('ambiguous');
    expect(pickMatch(results, { name: 'Boomerang' }).status).toBe('ambiguous');
  });
});
