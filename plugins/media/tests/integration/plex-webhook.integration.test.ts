import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, afterEach, it, vi } from 'vitest';
import app from '../../../../server/src/index';
import { query } from '../../../../server/src/db';
import { tmdb } from '../../services/tmdb';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser } from '../../../../server/tests/helpers/auth';

/** A user's per-account Plex webhook URL (their secret token is the last segment). */
async function plexUrlFor(userId: string): Promise<string> {
  const result = await query('SELECT webhook_token FROM users WHERE id = $1', [userId]);
  return `/api/v1/webhook/plex/${result.rows[0].webhook_token}`;
}

// The default user's webhook URL, refreshed after every database reset.
let plexUrl = '';

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
      // An episode's own guid identifies the episode; the show's identity is grandparentGuid.
      guid: 'plex://episode/5d9c086e7d3cd2002095d6bf',
      grandparentGuid: 'tmdb://169',
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

/**
 * plex_usernames moved from user_settings to the media plugin's
 * plugin_settings store (migration 044); it is read and written through the
 * generic plugin settings endpoints.
 */
async function setPlexUsernames(usernames: string) {
  const res = await request(app)
    .put('/api/v1/plugins/media/settings')
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
    plexUrl = await plexUrlFor(DEFAULT_USER_ID);
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  describe('per-user webhook URL', () => {
    const counts = async () => (await query(
      `SELECT (SELECT COUNT(*)::int FROM plex_webhook_events) AS events,
              (SELECT COUNT(*)::int FROM media_checkins) AS checkins,
              (SELECT COUNT(*)::int FROM media_items) AS items`,
      []
    )).rows[0];

    it('404s the old tokenless URL and writes nothing, signed in or not', async () => {
      const signedIn = await request(app).post('/api/v1/webhook/plex').send(movieScrobblePayload());
      expect(signedIn.status).toBe(404);
      const anonymous = await request(app).post('/api/v1/webhook/plex').unset('Cookie').send(movieScrobblePayload());
      expect(anonymous.status).toBe(404);
      expect(await counts()).toEqual({ events: 0, checkins: 0, items: 0 });
    });

    it('404s a wrong token (including a multipart upload) and writes nothing', async () => {
      const json = await request(app)
        .post('/api/v1/webhook/plex/not-a-real-token').unset('Cookie')
        .send(movieScrobblePayload());
      expect(json.status).toBe(404);
      const multipart = await request(app)
        .post('/api/v1/webhook/plex/not-a-real-token').unset('Cookie')
        .field('payload', JSON.stringify(movieScrobblePayload()));
      expect(multipart.status).toBe(404);
      expect(await counts()).toEqual({ events: 0, checkins: 0, items: 0 });
    });

    it('404s the token of a disabled account', async () => {
      await query('UPDATE users SET disabled_at = NOW() WHERE id = $1', [DEFAULT_USER_ID]);
      const res = await request(app).post(plexUrl).unset('Cookie').send(movieScrobblePayload());
      expect(res.status).toBe(404);
      expect(await counts()).toEqual({ events: 0, checkins: 0, items: 0 });
    });

    it('lands events only in the token owner\'s account, with their own username filter', async () => {
      const other = await createTestUser('other');
      const otherUrl = await plexUrlFor(other.id);
      expect(otherUrl).not.toBe(plexUrl);

      // The default user filters to "steve"; the other user tracks everyone.
      await setPlexUsernames('steve');

      const res = await request(app).post(otherUrl).unset('Cookie').send(movieScrobblePayload());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const items = await query('SELECT user_id, title FROM media_items', []);
      expect(items.rows).toEqual([{ user_id: other.id, title: 'Dune' }]);
      const checkins = await query('SELECT user_id FROM media_checkins', []);
      expect(checkins.rows).toEqual([{ user_id: other.id }]);
      const events = await query('SELECT user_id FROM plex_webhook_events', []);
      expect(events.rows).toEqual([{ user_id: other.id }]);

      // The same scrobble on the default user's URL is filtered by THEIR setting.
      const filtered = await request(app).post(plexUrl).unset('Cookie').send(movieScrobblePayload());
      expect(filtered.body).toEqual({ ok: true, skipped: 'username_filter' });

      // Each account's stats count only its own events.
      const mine = await request(app).get('/api/v1/webhook/plex/stats');
      expect(mine.body.count).toBe(1);
      const theirs = await request(app).get('/api/v1/webhook/plex/stats').set('Cookie', other.cookie);
      expect(theirs.body.count).toBe(1);

      // And neither library shows the other's item.
      const myLibrary = await request(app).get('/api/v1/media/library');
      expect(myLibrary.body.total).toBe(0);
      const theirLibrary = await request(app).get('/api/v1/media/library').set('Cookie', other.cookie);
      expect(theirLibrary.body.rows.map((r: { title: string }) => r.title)).toEqual(['Dune']);
    });

    it('stops accepting the old URL once the token is regenerated', async () => {
      const regenerated = await request(app).post('/api/v1/auth/webhook-token/regenerate');
      expect(regenerated.status).toBe(200);
      const old = await request(app).post(plexUrl).unset('Cookie').send(movieScrobblePayload());
      expect(old.status).toBe(404);
      const fresh = await request(app)
        .post(`/api/v1/webhook/plex/${regenerated.body.token}`).unset('Cookie')
        .send(movieScrobblePayload());
      expect(fresh.status).toBe(200);
    });

    it('keeps the stats route behind sign-in', async () => {
      const res = await request(app).get('/api/v1/webhook/plex/stats').unset('Cookie');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/webhook/plex/:token', () => {
    it('rejects payloads without a valid event field', async () => {
      const response = await request(app)
        .post(plexUrl).unset('Cookie')
        .send({ Account: { title: 'zach' } });

      expect(response.status).toBe(400);
    });

    it('creates a movie item and completed check-in from a media.scrobble', async () => {
      const response = await request(app)
        .post(plexUrl).unset('Cookie')
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
      const first = await request(app).post(plexUrl).unset('Cookie').send(movieScrobblePayload());
      const second = await request(app).post(plexUrl).unset('Cookie').send(movieScrobblePayload());
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const items = await query('SELECT COUNT(*)::int AS n FROM media_items', []);
      expect(items.rows[0].n).toBe(1);

      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins', []);
      expect(checkins.rows[0].n).toBe(2);
    });

    it('creates a tv_show item with season/episode fields from an episode scrobble', async () => {
      const response = await request(app)
        .post(plexUrl).unset('Cookie')
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

    it('reuses one local show item across episodes of a show without a tmdb guid', async () => {
      const noTmdb = (index: number) => {
        const payload = episodeScrobblePayload();
        const metadata = payload.Metadata as Record<string, unknown>;
        delete metadata.grandparentGuid;
        metadata.guid = `plex://episode/ep${index}`;
        metadata.index = index;
        metadata.title = `Episode ${index}`;
        return payload;
      };
      await request(app).post(plexUrl).unset('Cookie').send(noTmdb(1));
      await request(app).post(plexUrl).unset('Cookie').send(noTmdb(2));
      await request(app).post(plexUrl).unset('Cookie').send(noTmdb(3));

      const items = await query(`SELECT id FROM media_items WHERE media_type = 'tv_show'`, []);
      expect(items.rows).toHaveLength(1);
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins WHERE media_item_id = $1', [items.rows[0].id]);
      expect(checkins.rows[0].n).toBe(3);
    });

    it('accepts the payload as a multipart text field (as Plex sends it)', async () => {
      const response = await request(app)
        .post(plexUrl).unset('Cookie')
        .field('payload', JSON.stringify(movieScrobblePayload()));
      expect(response.status).toBe(200);
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins', []);
      expect(checkins.rows[0].n).toBe(1);
    });

    it('logs every event to plex_webhook_events with the Plex username', async () => {
      await request(app).post(plexUrl).unset('Cookie').send(movieScrobblePayload());
      await request(app).post(plexUrl).unset('Cookie').send(episodeScrobblePayload());

      const events = await query(
        'SELECT event, plex_username FROM plex_webhook_events ORDER BY received_at, id'
      );
      expect(events.rows).toHaveLength(2);
      expect(events.rows.map((r: any) => r.plex_username)).toEqual(['zach', 'steve']);
    });

    it('skips scrobbles from users outside the username filter (case-insensitive)', async () => {
      await setPlexUsernames(' Zach , steve ');

      const matching = await request(app)
        .post(plexUrl).unset('Cookie')
        .send(movieScrobblePayload({ Account: { id: 2, title: 'ZACH' } }));
      expect(matching.status).toBe(200);
      expect(matching.body.skipped).toBeUndefined();

      const nonMatching = await request(app)
        .post(plexUrl).unset('Cookie')
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
        .post(plexUrl).unset('Cookie')
        .send(movieScrobblePayload({ Account: { id: 9, title: 'anyone' } }));
      expect(response.status).toBe(200);

      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins', []);
      expect(checkins.rows[0].n).toBe(1);
    });

    it('handles a non-tmdb guid by creating a local (title-only) item', async () => {
      const response = await request(app)
        .post(plexUrl).unset('Cookie')
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
        .post(plexUrl).unset('Cookie')
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

      await request(app).post(plexUrl).unset('Cookie').send(movieScrobblePayload());

      const after = await request(app).get('/api/v1/webhook/plex/stats');
      expect(after.status).toBe(200);
      expect(after.body.count).toBe(1);
    });
  });

  describe('plex_usernames plugin settings round-trip', () => {
    it('persists via PUT /api/v1/plugins/media/settings and returns it on GET', async () => {
      const updated = await setPlexUsernames('zach, steve');
      expect(updated).toBe('zach, steve');

      const fetched = await request(app).get('/api/v1/plugins/media/settings');
      expect(fetched.status).toBe(200);
      expect(fetched.body.plex_usernames).toBe('zach, steve');

      // The value lands in plugin_settings, not user_settings.
      const row = await query(
        `SELECT value FROM plugin_settings WHERE user_id = $1 AND plugin_id = 'media' AND key = 'plex_usernames'`,
        [DEFAULT_USER_ID]
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].value).toBe('zach, steve');
    });

    it('stores an empty filter as an empty string (track everyone)', async () => {
      await setPlexUsernames('');

      const row = await query(
        `SELECT value FROM plugin_settings WHERE user_id = $1 AND plugin_id = 'media' AND key = 'plex_usernames'`,
        [DEFAULT_USER_ID]
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].value).toBe('');
    });

    it('rejects settings keys the media plugin does not declare', async () => {
      const res = await request(app)
        .put('/api/v1/plugins/media/settings')
        .send({ not_a_setting: 'x' });
      expect(res.status).toBe(400);
    });
  });
  // Real payloads from current Plex agents: plex:// guids, with the external
  // ids in Guid[] (an episode's Guid[] identifies the episode, not the show).
  describe('TMDB identity resolution', () => {
    const realMovie = () => movieScrobblePayload({
      Metadata: {
        type: 'movie',
        title: 'The Land Before Time XIV: Journey of the Brave',
        guid: 'plex://movie/5d776ba0594b2b001e6df2d4',
        Guid: [{ id: 'imdb://tt4431254' }, { id: 'tmdb://339526' }, { id: 'tvdb://23620' }],
      },
    });
    const realEpisode = (grandparentTitle: string, Guid: { id: string }[]) => episodeScrobblePayload({
      Metadata: {
        type: 'episode',
        title: 'The Adventure',
        guid: 'plex://episode/5e1618ac67f14f001e692e13',
        grandparentGuid: 'plex://show/5d9c08172192ba001f3071b9',
        grandparentTitle,
        parentIndex: 1,
        index: 2,
        Guid,
      },
    });
    const showDetails = { title: 'Bluey', releaseYear: 2018, imageUrl: 'https://image.tmdb.org/t/p/w500/bluey.jpg' };

    beforeEach(async () => {
      await request(app).put('/api/v1/plugins/media/settings').send({ tmdb_api_key: 'test-key' });
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('resolves a movie from Guid[] and stores poster, year and url', async () => {
      vi.spyOn(tmdb, 'getMovieDetails').mockResolvedValue({
        title: 'The Land Before Time XIV: Journey of the Brave', releaseYear: 2016, imageUrl: 'https://image.tmdb.org/t/p/w500/lbt.jpg',
      });
      await request(app).post(plexUrl).unset('Cookie').send(realMovie());

      const item = await query(`SELECT * FROM media_items WHERE media_type = 'movie'`, []);
      expect(item.rows).toHaveLength(1);
      expect(item.rows[0].external_source).toBe('tmdb');
      expect(item.rows[0].external_id).toBe('339526');
      expect(item.rows[0].image_url).toBe('https://image.tmdb.org/t/p/w500/lbt.jpg');
      expect(item.rows[0].release_year).toBe(2016);
    });

    it('resolves a show via the episode tvdb id and reuses the existing TMDB item', async () => {
      await query(
        `INSERT INTO media_items (user_id, media_type, external_source, external_id, title)
         VALUES ($1, 'tv_show', 'tmdb', '82728', 'Bluey')`,
        [DEFAULT_USER_ID]
      );
      const find = vi.spyOn(tmdb, 'findShowId').mockResolvedValue('82728');
      vi.spyOn(tmdb, 'getTvShowDetails').mockResolvedValue(showDetails);

      await request(app).post(plexUrl).unset('Cookie')
        .send(realEpisode('Bluey (2018)', [{ id: 'imdb://tt12612672' }, { id: 'tmdb://1836008' }, { id: 'tvdb://7116588' }]));

      expect(find).toHaveBeenCalledWith('test-key', 'tvdb_id', '7116588');
      const items = await query(`SELECT * FROM media_items WHERE media_type = 'tv_show'`, []);
      expect(items.rows).toHaveLength(1);
      expect(items.rows[0].external_id).toBe('82728');
      // The pre-existing item had no poster; the webhook fills the gap.
      expect(items.rows[0].image_url).toBe(showDetails.imageUrl);
      const checkins = await query('SELECT season_number, episode_number FROM media_checkins WHERE media_item_id = $1', [items.rows[0].id]);
      expect(checkins.rows).toEqual([{ season_number: 1, episode_number: 2 }]);
    });

    it('falls back to an exact-title TMDB search when no tvdb/imdb id is available', async () => {
      vi.spyOn(tmdb, 'searchTv').mockResolvedValue([
        { externalId: '1', title: 'Bluey Remake', releaseYear: 2018, imageUrl: null, externalUrl: '' },
        { externalId: '82728', title: 'Bluey', releaseYear: 2018, imageUrl: showDetails.imageUrl, externalUrl: 'https://www.themoviedb.org/tv/82728' },
      ]);

      await request(app).post(plexUrl).unset('Cookie').send(realEpisode('Bluey (2018)', [{ id: 'tmdb://1836008' }]));

      const items = await query(`SELECT * FROM media_items WHERE media_type = 'tv_show'`, []);
      expect(items.rows).toHaveLength(1);
      expect(items.rows[0].external_id).toBe('82728');
      expect(items.rows[0].title).toBe('Bluey');
      expect(items.rows[0].image_url).toBe(showDetails.imageUrl);
    });

    it('adopts a local-only item with the same title instead of duplicating it', async () => {
      await query(
        `INSERT INTO media_items (user_id, media_type, title) VALUES ($1, 'tv_show', 'Bluey (2018)')`,
        [DEFAULT_USER_ID]
      );
      vi.spyOn(tmdb, 'findShowId').mockResolvedValue('82728');
      vi.spyOn(tmdb, 'getTvShowDetails').mockResolvedValue(showDetails);

      await request(app).post(plexUrl).unset('Cookie').send(realEpisode('Bluey (2018)', [{ id: 'tvdb://7116588' }]));

      const items = await query(`SELECT * FROM media_items WHERE media_type = 'tv_show'`, []);
      expect(items.rows).toHaveLength(1);
      expect(items.rows[0].external_source).toBe('tmdb');
      expect(items.rows[0].external_id).toBe('82728');
      expect(items.rows[0].title).toBe('Bluey');
    });

    it('falls back to a title-only item when TMDB resolves nothing', async () => {
      vi.spyOn(tmdb, 'findShowId').mockResolvedValue(null);
      vi.spyOn(tmdb, 'searchTv').mockResolvedValue([]);

      await request(app).post(plexUrl).unset('Cookie').send(realEpisode('Obscure Show', [{ id: 'tvdb://1' }]));
      await request(app).post(plexUrl).unset('Cookie').send(realEpisode('Obscure Show', [{ id: 'tvdb://2' }]));

      const items = await query(`SELECT * FROM media_items WHERE media_type = 'tv_show'`, []);
      expect(items.rows).toHaveLength(1);
      expect(items.rows[0].external_source).toBeNull();
      expect(items.rows[0].title).toBe('Obscure Show');
      const checkins = await query('SELECT COUNT(*)::int AS n FROM media_checkins', []);
      expect(checkins.rows[0].n).toBe(2);
    });
  });
});
