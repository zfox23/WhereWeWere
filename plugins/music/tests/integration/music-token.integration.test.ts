import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it, vi } from 'vitest';

// Must be set before the app (and its config) is imported.
vi.hoisted(() => {
  process.env.API_ACCESS_TOKEN = 'integration-test-token';
});

import app from '../../../../server/src/index';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { getMusicSettings } from '../../services/scrobbles';

describe('scrobbler protocol with API_ACCESS_TOKEN set', () => {
  let key = '';
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  it('guards the app API but lets multi-scrobbler in with its own key', async () => {
    expect((await request(app).get('/api/v1/music/settings')).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/music/settings').set('x-wherewewere-token', 'integration-test-token')).status,
    ).toBe(200);

    expect((await request(app).get('/apis/mlj_1/serverinfo')).status).toBe(200);
    expect((await request(app).get('/apis/mlj_1/test').query({ key })).body).toEqual({ status: 'ok' });
    const res = await request(app)
      .post('/apis/mlj_1/newscrobble')
      .send({ title: 'Song', artists: ['Artist'], time: 1714564800, key });
    expect(res.status).toBe(200);
    expect((await request(app).get('/apis/mlj_1/test').query({ key: 'wrong' })).status).toBe(403);
  });
});
