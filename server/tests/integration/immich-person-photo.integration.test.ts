import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Redirect the person-photo disk cache to a temp dir BEFORE the app (and its
// config) is imported.
const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'www-immich-test-'));
process.env.DATA_DIR = tmpDataDir;

const IMMICH_URL = 'http://immich.test:2283';
const IMMICH_KEY = 'test-api-key';
const PHOTO_BYTES = new Uint8Array([1, 2, 3, 4]);

let app: typeof import('../../src/index').default;
let query: typeof import('../../src/db').query;
let resetIntegrationDatabase: typeof import('../helpers/testDb').resetIntegrationDatabase;
let setupIntegrationDatabase: typeof import('../helpers/testDb').setupIntegrationDatabase;
let teardownIntegrationDatabase: typeof import('../helpers/testDb').teardownIntegrationDatabase;

const fetchMock = vi.fn();

/** Configure the stubbed Immich responses. */
function stubImmich(people: { id: string; name: string }[]) {
  fetchMock.mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.startsWith(`${IMMICH_URL}/api/search/person`)) {
      return {
        ok: true,
        status: 200,
        json: async () => people,
        headers: new Headers(),
      };
    }
    if (url.startsWith(`${IMMICH_URL}/api/people/`)) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => PHOTO_BYTES.buffer,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

async function setImmichConfigured() {
  await query(
    `INSERT INTO user_settings (user_id, immich_url, immich_api_key)
     VALUES ('00000000-0000-0000-0000-000000000001', $1, $2)
     ON CONFLICT (user_id) DO UPDATE SET immich_url = $1, immich_api_key = $2`,
    [IMMICH_URL, IMMICH_KEY]
  );
}

describe('Immich person photos', () => {
  beforeAll(async () => {
    vi.stubGlobal('fetch', fetchMock);
    ({ default: app } = await import('../../src/index'));
    ({ query } = await import('../../src/db'));
    ({
      setupIntegrationDatabase,
      resetIntegrationDatabase,
      teardownIntegrationDatabase,
    } = await import('../helpers/testDb'));
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    fetchMock.mockReset();
    await resetIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
    vi.unstubAllGlobals();
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('404s when Immich is not configured', async () => {
    const res = await request(app).get('/api/v1/immich/person-photo?name=John%20Doe');
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s without a name', async () => {
    const res = await request(app).get('/api/v1/immich/person-photo');
    expect(res.status).toBe(400);
  });

  it('proxies the featured thumbnail and serves repeats from the disk cache', async () => {
    await setImmichConfigured();
    stubImmich([{ id: 'person-1', name: 'John Doe' }]);

    const first = await request(app).get('/api/v1/immich/person-photo?name=John%20Doe');
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toContain('image/jpeg');
    expect(first.headers['cache-control']).toContain('max-age=3600');
    expect(Buffer.from(first.body).equals(Buffer.from(PHOTO_BYTES))).toBe(true);
    // One search + one thumbnail fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = await request(app).get('/api/v1/immich/person-photo?name=John%20Doe');
    expect(second.status).toBe(200);
    expect(Buffer.from(second.body).equals(Buffer.from(PHOTO_BYTES))).toBe(true);
    // Served from the disk cache — no additional Immich calls.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('404s and negatively caches unknown people', async () => {
    await setImmichConfigured();
    stubImmich([]);

    const first = await request(app).get('/api/v1/immich/person-photo?name=Ghost');
    expect(first.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await request(app).get('/api/v1/immich/person-photo?name=Ghost');
    expect(second.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not leak one name cache to another name', async () => {
    await setImmichConfigured();
    stubImmich([{ id: 'person-1', name: 'John Doe' }]);

    const res = await request(app).get('/api/v1/immich/person-photo?name=John%20Doe');
    expect(res.status).toBe(200);
    const callsAfterJohn = fetchMock.mock.calls.length;

    // A different name must hit Immich again even though a cache exists.
    stubImmich([]);
    const res2 = await request(app).get('/api/v1/immich/person-photo?name=Jane%20Doe');
    expect(res2.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterJohn + 1);
  });
});
