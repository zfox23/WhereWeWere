import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, it } from 'vitest';
import app from '../../src/index';
import { query } from '../../src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../helpers/testDb';

function movieScrobblePayload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'media.scrobble',
    user: true,
    owner: true,
    Account: { id: 2, title: 'zach' },
    Server: { title: 'Home Server', uuid: '54664a3d8acc39983675640ec9ce00b70af9cc36' },
    Metadata: {
      librarySectionType: 'movie',
      ratingKey: '12345',
      key: '/library/metadata/12345',
      guid: 'tmdb://550',
      type: 'movie',
      title: 'Dune',
      addedAt: 1700000000,
      updatedAt: 1720000000,
    },
    ...overrides,
  };
}

function episodeScrobblePayload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'media.scrobble',
    user: true,
    owner: false,
    Account: { id: 3, title: 'steve' },
    Server: { title: 'Home Server', uuid: '54664a3d8acc39983675640ec9ce00b70af9cc36' },
    Metadata: {
      librarySectionType: 'show',
      ratingKey: '67891',
      key: '/library/metadata/67891',
      parentRatingKey: '67890',
      grandparentRatingKey: '67889',
      guid: 'tmdb://169',
      type: 'episode',
      title: 'Pilot',
      grandparentTitle: 'Breaking Bad',
      parentIndex: 1,
      index: 1,
      addedAt: 1700000000,
      updatedAt: 1720000000,
    },
    ...overrides,
  };
}

async function setPlexUsernames(usernames: string) {
  const res = await request(app)
    .put('/api/v1/settings')
    .send({ plex_usernames: usernames });
  expect(res.status).toBe(200);
  return res.body.plex_usernames;
}

describe('Plex webhook API', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  describe('POST /api/v1/webhook/plex', () => {
    it('rejects payloads without a valid event field', async () => {
      const response = await request(app)
        .post('/api/v1/webhook/plex')
        .send({ Account: { title: 'zach' } });

      expect(response.status).toBe(400);
    });

    it('creates a movie item and completed check-in from a media.scrobble', async () => {
      const response = await request(app)
        .post('/api/v1/webhook/plex')
        .send(movieScrobblePayload());

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);

      const item = await query(
        `SELECT * FROM media_items WHERE user_id = $1 AND external_source = 'tmdb' AND external_id = '550'`,
        [DEFAULT_USER_ID]
      );
      expect(item.rows).toHaveLength(1);
      expect(item.rows[0].media_type).toBe('movie');
      expect(item.rows[0].title).toBe('Dune');

      const checkin = await query(
        `SELECT * FROM media_checkins WHERE user_id = $1 AND media_item_id = $2`,
        [DEFAULT_USER_ID, item.rows[0].id]
      );
      expect(checkin.rows).toHaveLength(1);
      expect(checkin.rows[0].checkin_type).toBe('completed');
      expect(checkin.rows[0].season_number).toBeNull();
      expect(checkin.rows[0].episode_number).toBeNull();
    });

    it('re-scrobbling the same movie creates a new check-in (no dedupe)', async () => {
      const first = await request(app).post('/api/v1/webhook/plex').send(movieScrobblePayload());
      const second = await request(app).post('/api/v1/webhook/plex').send(movieScrobblePayload());
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const items = await query('SELECT COUNT(*)::int AS n FROM media_items', []);
      expect(items.rows[0].n).toBe(1);

      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins', []);
      expect(checkins.rows[0].n).toBe(2);
    });

    it('creates a tv_show item with season/episode fields from an episode scrobble', async () => {
      const response = await request(app)
        .post('/api/v1/webhook/plex')
        .send(episodeScrobblePayload());

      expect(response.status).toBe(200);

      const item = await query(
        `SELECT * FROM media_items WHERE user_id = $1 AND external_source = 'tmdb' AND external_id = '169'`,
        [DEFAULT_USER_ID]
      );
      expect(item.rows).toHaveLength(1);
      expect(item.rows[0].media_type).toBe('tv_show');
      expect(item.rows[0].title).toBe('Breaking Bad');

      const checkin = await query(
        `SELECT * FROM media_checkins WHERE user_id = $1 AND media_item_id = $2`,
        [DEFAULT_USER_ID, item.rows[0].id]
      );
      expect(checkin.rows).toHaveLength(1);
      expect(checkin.rows[0].season_number).toBe(1);
      expect(checkin.rows[0].episode_number).toBe(1);
      expect(checkin.rows[0].episode_title).toBe('Pilot');
    });

    it('logs every event to plex_webhook_events with the Plex username', async () => {
      await request(app).post('/api/v1/webhook/plex').send(movieScrobblePayload());
      await request(app).post('/api/v1/webhook/plex').send(episodeScrobblePayload());

      const events = await query(
        'SELECT event, plex_username FROM plex_webhook_events ORDER BY received_at, id'
      );
      expect(events.rows).toHaveLength(2);
      expect(events.rows.map((r) => r.plex_username)).toEqual(['zach', 'steve']);
    });

    it('skips scrobbles from users outside the username filter (case-insensitive)', async () => {
      await setPlexUsernames(' Zach , steve ');

      const matching = await request(app)
        .post('/api/v1/webhook/plex')
        .send(movieScrobblePayload({ Account: { id: 2, title: 'ZACH' } }));
      expect(matching.status).toBe(200);
      expect(matching.body.skipped).toBeUndefined();

      const nonMatching = await request(app)
        .post('/api/v1/webhook/plex')
        .send(episodeScrobblePayload({ Account: { id: 3, title: 'mallory' } }));
      expect(nonMatching.status).toBe(200);
      expect(nonMatching.body.skipped).toBe('username_filter');

      // Only the matching user produced a check-in; both events were still logged.
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins', []);
      expect(checkins.rows[0].n).toBe(1);
      const events = await query('SELECT COUNT(*)::int AS n FROM plex_webhook_events', []);
      expect(events.rows[0].n).toBe(2);
    });

    it('tracks all users when the username filter is empty', async () => {
      await setPlexUsernames('');

      const response = await request(app)
        .post('/api/v1/webhook/plex')
        .send(movieScrobblePayload({ Account: { id: 9, title: 'anyone' } }));
      expect(response.status).toBe(200);

      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins', []);
      expect(checkins.rows[0].n).toBe(1);
    });

    it('handles a non-tmdb guid by creating a local (title-only) item', async () => {
      const response = await request(app)
        .post('/api/v1/webhook/plex')
        .send(movieScrobblePayload({ Metadata: { type: 'movie', title: 'Local Film', guid: 'plex://movie/1' } }));
      expect(response.status).toBe(200);

      const item = await query(
        `SELECT * FROM media_items WHERE user_id = $1 AND title = 'Local Film'`,
        [DEFAULT_USER_ID]
      );
      expect(item.rows).toHaveLength(1);
      expect(item.rows[0].external_source).toBeNull();
      expect(item.rows[0].external_id).toBeNull();
    });

    it('ignores events other than media.scrobble (but still logs them)', async () => {
      const response = await request(app)
        .post('/api/v1/webhook/plex')
        .send({ event: 'media.play', Account: { title: 'zach' }, Metadata: { type: 'movie', title: 'X' } });

      expect(response.status).toBe(200);
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins', []);
      expect(checkins.rows[0].n).toBe(0);
      const events = await query('SELECT COUNT(*)::int AS n FROM plex_webhook_events WHERE event = \'media.play\'', []);
      expect(events.rows[0].n).toBe(1);
    });
  });

  describe('GET /api/v1/webhook/plex/stats', () => {
    it('returns the number of received events', async () => {
      const before = await request(app).get('/api/v1/webhook/plex/stats');
      expect(before.status).toBe(200);
      expect(before.body.count).toBe(0);

      await request(app).post('/api/v1/webhook/plex').send(movieScrobblePayload());

      const after = await request(app).get('/api/v1/webhook/plex/stats');
      expect(after.status).toBe(200);
      expect(after.body.count).toBe(1);
    });
  });

  describe('settings round-trip', () => {
    it('persists plex_usernames via PUT /api/v1/settings and returns it on GET', async () => {
      const updated = await setPlexUsernames('zach, steve');
      expect(updated).toBe('zach, steve');

      const fetched = await request(app).get('/api/v1/settings');
      expect(fetched.status).toBe(200);
      expect(fetched.body.plex_usernames).toBe('zach, steve');
    });

    it('clears plex_usernames when an empty string is sent', async () => {
      await setPlexUsernames('zach');

      const cleared = await request(app).put('/api/v1/settings').send({ plex_usernames: '' });
      expect(cleared.status).toBe(200);
      expect(cleared.body.plex_usernames).toBeNull();
    });
  });
});
