import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { describe, expect, beforeAll, beforeEach, afterAll, afterEach, it } from 'vitest';
import app from '../../../../server/src/index';
import { config } from '../../../../server/src/config';
import { query } from '../../../../server/src/db';
import {
  DEFAULT_USER_ID,
  resetIntegrationDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
} from '../../../../server/tests/helpers/testDb';
import { createTestUser } from '../../../../server/tests/helpers/auth';
import { getMusicSettings } from '../../services/scrobbles';
import { setAlbumDeps, whenBackfillDone, type AlbumDeps } from '../../services/albums';
import { ProviderUnavailableError } from '../../services/albumProviders';
import type { AlbumMatch } from '../../services/albumMatch';

const BASE = '/apis/mlj_1';
const T0 = 1714564800;

let key = '';
let png: Buffer;
let dataDir = '';
const originalDataDir = config.dataDir;

const match = (over: Partial<AlbumMatch> = {}): AlbumMatch => ({
  provider: 'deezer',
  externalId: '42',
  title: 'Group Therapy',
  artist: 'Above & Beyond',
  releaseDate: '2011-06-14',
  label: 'Anjunabeats',
  tracks: [
    { position: 1, title: 'Filaments', length: 300 },
    { position: 2, title: 'Sun & Moon', length: 321 },
    { position: 3, title: 'Oceanic', length: 250 },
  ],
  thumbUrl: 'https://img/250.jpg',
  largeUrl: 'https://img/1000.jpg',
  ...over,
});

let currentDeps: AlbumDeps | null = null;
const setAlbumDepsSnapshot = () => currentDeps;
let finds: string[] = [];
let imageHits: string[] = [];
function useDeps(find: (album: string) => Promise<AlbumMatch | null>, imageStatus = 200) {
  const deps: AlbumDeps = {
    provider: { find: async (p) => { finds.push(p.album); return find(p.album); } },
    fetchImage: async (url) => {
      imageHits.push(url);
      return { ok: imageStatus < 400, status: imageStatus, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer };
    },
  };
  currentDeps = deps;
  setAlbumDeps(deps);
}

const push = (title: string, album: string | undefined, artists = ['Above & Beyond'], offset = 0) =>
  request(app).post(`${BASE}/newscrobble`).send({ title, artists, album, time: T0 + offset, key });
const backfill = async (body: object = {}) => {
  const res = await request(app).post('/api/v1/music/albums/backfill').send(body);
  await whenBackfillDone();
  return res;
};
const status = async () => (await request(app).get('/api/v1/music/albums/status')).body;

describe('music metadata', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c33' } }).png().toBuffer();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-art-'));
    config.dataDir = dataDir;
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
    // A lookup only collects art files that have sat unused a while, so
    // clear what earlier tests left behind.
    fs.rmSync(path.join(dataDir, 'music-art'), { recursive: true, force: true });
    key = (await getMusicSettings(DEFAULT_USER_ID)).scrobbler_key;
    finds = [];
    imageHits = [];
  });
  afterEach(() => setAlbumDeps(null));
  afterAll(async () => {
    config.dataDir = originalDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
    await teardownIntegrationDatabase();
  });

  it('does nothing and refuses to start without a configured lookup', async () => {
    await push('Sun & Moon', 'Group Therapy');
    expect((await request(app).post('/api/v1/music/albums/backfill').send({})).status).toBe(503);
    expect((await status()).enabled).toBe(false);
  });

  it('derives one album key from the first album artist, else the track artist', async () => {
    await push('A', 'Group Therapy ', ['Above & Beyond']);
    await push('B', 'group therapy', ['ABOVE & BEYOND', 'Guest'], 60);
    await push('C', undefined, ['Above & Beyond'], 120);
    const rows = (await query('SELECT album_key FROM music_scrobbles ORDER BY played_at')).rows;
    expect(rows.map((r: any) => r.album_key)).toEqual(['group therapy|above & beyond', 'group therapy|above & beyond', null]);
  });

  it('backfills albums, most played first, storing a thumbnail and the tracklist', async () => {
    await push('Sun & Moon', 'Group Therapy');
    await push('Oceanic', 'Group Therapy', ['Above & Beyond'], 300);
    await push('Other', 'Rare Album', ['Someone'], 600);
    useDeps(async (album) => (album === 'Group Therapy' ? match() : null));
    expect((await backfill()).status).toBe(202);
    expect(finds).toEqual(['Group Therapy', 'Rare Album']);
    expect((await status()).albums).toEqual({ total: 2, matched: 1, not_found: 1, pending: 0 });

    const row = (await query(`SELECT id, thumb_file FROM music_albums WHERE status = 'matched'`)).rows[0];
    const thumb = await request(app).get(`/api/v1/music/albums/${row.id}/art`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    expect(thumb.headers['cache-control']).toContain('immutable');
    const meta = await sharp(thumb.body as Buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 96, 96]);

    // A second run only looks at what is new.
    finds = [];
    const deps = setAlbumDepsSnapshot();
    setAlbumDeps(null); // so the arrival of 'Fresh' doesn't look it up on its own
    await push('New', 'Fresh', ['Someone'], 900);
    setAlbumDeps(deps);
    await backfill();
    expect(finds).toEqual(['Fresh']);
  });

  it('retries "not found" albums only when asked', async () => {
    await push('Sun & Moon', 'Group Therapy');
    useDeps(async () => null);
    await backfill();
    finds = [];
    await backfill();
    expect(finds).toEqual([]);
    useDeps(async () => match());
    await backfill({ retry_missing: true });
    expect((await status()).albums).toMatchObject({ matched: 1, not_found: 0 });
  });

  it('skips albums a catalog is unavailable for, keeps going, and leaves them for the next run', async () => {
    await push('A', 'Flaky Album', ['X']);
    await push('B', 'Good Album', ['Y'], 600);
    await push('C', 'Good Album', ['Y'], 1200);
    useDeps(async (album) => {
      if (album === 'Flaky Album') throw new ProviderUnavailableError('MusicBrainz returned HTTP 503');
      return match({ externalId: '7', title: 'Good Album' });
    });
    await backfill();
    const s = await status();
    expect(s.job).toMatchObject({ state: 'done', matched: 1, skipped: 1, error: null });
    expect(s.albums).toMatchObject({ pending: 1, matched: 1, not_found: 0 });
    // Tried once, not endlessly, within the run.
    expect(finds.filter((a) => a === 'Flaky Album')).toHaveLength(1);

    finds = [];
    useDeps(async () => match({ externalId: '8', title: 'Flaky Album' }));
    await backfill();
    expect(finds).toEqual(['Flaky Album']);
    expect((await status()).albums.pending).toBe(0);
  });

  it('stops the run when a catalog keeps failing, recording nothing for the failed albums', async () => {
    for (let i = 0; i < 8; i++) await push(`T${i}`, `Album ${i}`, ['X'], i * 600);
    useDeps(async () => { throw new ProviderUnavailableError('MusicBrainz returned HTTP 503'); });
    await backfill();
    const s = await status();
    expect(s.job).toMatchObject({ state: 'error', error: 'MusicBrainz returned HTTP 503' });
    expect(finds).toHaveLength(5);
    expect(s.albums).toMatchObject({ pending: 8, matched: 0, not_found: 0 });
  });

  it('describes an album with the user\'s play counts, across keys sharing a release', async () => {
    // The Last.fm import credits each track's own artist, so one soundtrack is several keys.
    await push('Filaments', 'Group Therapy', ['Above & Beyond']);
    await push('Sun & Moon (Remastered)', 'Group Therapy', ['Above & Beyond'], 300);
    await push('Sun & Moon', 'Group Therapy', ['Above & Beyond'], 600);
    await push('Oceanic', 'Group Therapy', ['Zoë Johnston'], 900);
    useDeps(async () => match());
    await backfill();
    const id = (await query(`SELECT id FROM music_albums LIMIT 1`)).rows[0].id;
    const res = await request(app).get('/api/v1/music/album-view').query({ art_id: id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Group Therapy', artist: 'Above & Beyond', release_date: '2011-06-14', label: 'Anjunabeats', plays: 4 });
    expect(res.body.tracks.map((t: any) => [t.title, t.length, t.plays])).toEqual([
      ['Filaments', 300, 1],
      ['Sun & Moon', 321, 2],
      ['Oceanic', 250, 1],
    ]);
    expect(res.body).toMatchObject({ matched: true, album_ref: 'group therapy|above & beyond' });
    expect((await request(app).get('/api/v1/music/album-view').query({ art_id: 'not-a-uuid' })).status).toBe(400);
    expect((await request(app).get('/api/v1/music/album-view').query({ art_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await request(app).get('/api/v1/music/album-view')).status).toBe(400);
    expect((await request(app).get('/api/v1/music/album-view').query({ ref: 'never played|nobody' })).status).toBe(404);
  });

  describe('album view', () => {
    const view = (ref: string) => request(app).get('/api/v1/music/album-view').query({ ref });

    it('describes an album with no catalog match from the plays alone', async () => {
      await push('Deep Cut', 'Obscure LP', ['Someone'], 0);
      await push('Hit', 'Obscure LP', ['Someone'], 300);
      await push('Hit', 'Obscure LP', ['Someone'], 600);
      await request(app).post(`${BASE}/newscrobble`).send({ title: 'Hit', artists: ['Someone'], album: 'Obscure LP', time: T0 + 900, length: 200, key });
      const res = await view('obscure lp|someone');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        matched: false, art_id: null, title: 'Obscure LP', artist: 'Someone',
        release_date: null, label: null, plays: 4,
      });
      // Most played first; lengths only where known; no catalog positions.
      expect(res.body.tracks.map((t: any) => [t.title, t.plays, t.length, t.position])).toEqual([
        ['Hit', 3, 200, null],
        ['Deep Cut', 1, null, null],
      ]);
      expect(res.body.tracks[0]).toMatchObject({ artists: ['Someone'] });
      expect(res.body.tracks[0].song_key).toEqual(expect.any(String));
    });

    it('gathers an artist\'s plays without an album under "Unknown album"', async () => {
      await push('Loose One', undefined, ['Some Artist']);
      await push('Loose Two', undefined, ['Some Artist'], 60);
      await push('Not Theirs', undefined, ['Other Artist'], 120);
      await push('Has Album', 'Real Album', ['Some Artist'], 180);
      const res = await view('|some artist');
      expect(res.body).toMatchObject({ title: 'Unknown album', artist: 'Some Artist', plays: 2, matched: false });
      expect(res.body.tracks.map((t: any) => t.title).sort()).toEqual(['Loose One', 'Loose Two']);
    });

    it('lists the whole catalog tracklist for a match, then played tracks that are not on it', async () => {
      await push('Sun & Moon', 'Group Therapy');
      await push('Hidden Bonus', 'Group Therapy', ['Above & Beyond'], 60);
      useDeps(async () => match());
      await backfill();
      const res = await view('group therapy|above & beyond');
      expect(res.body).toMatchObject({ matched: true, art_id: expect.any(String), release_date: '2011-06-14', plays: 2 });
      expect(res.body.tracks.map((t: any) => [t.position, t.title, t.plays, t.song_key !== null])).toEqual([
        [1, 'Filaments', 0, false], // never played: nothing to add to a list
        [2, 'Sun & Moon', 1, true],
        [3, 'Oceanic', 0, false],
        [null, 'Hidden Bonus', 1, true],
      ]);
      expect(res.body.tracks[0].artists).toEqual(['Above & Beyond']); // falls back to the album artist
    });
  });

  it('fetches the large cover on first open and keeps it', async () => {
    await push('Sun & Moon', 'Group Therapy');
    useDeps(async () => match());
    await backfill();
    const id = (await query(`SELECT id FROM music_albums LIMIT 1`)).rows[0].id;
    imageHits = [];
    const first = await request(app).get(`/api/v1/music/albums/${id}/art`).query({ size: 'large' });
    expect(first.status).toBe(200);
    const second = await request(app).get(`/api/v1/music/albums/${id}/art`).query({ size: 'large' });
    expect(second.status).toBe(200);
    expect(imageHits).toEqual(['https://img/1000.jpg']);
  });

  it('records the match but no thumbnail when the release has no cover', async () => {
    await push('Sun & Moon', 'Group Therapy');
    useDeps(async () => match(), 404);
    await backfill();
    const row = (await query(`SELECT id, thumb_file FROM music_albums`)).rows[0];
    expect(row.thumb_file).toBeNull();
    expect((await request(app).get(`/api/v1/music/albums/${row.id}/art`)).status).toBe(404);
  });

  it('looks up the album of an arriving scrobble without delaying the response', async () => {
    let release!: () => void;
    useDeps(() => new Promise((resolve) => { release = () => resolve(match()); }));
    const res = await push('Sun & Moon', 'Group Therapy');
    expect(res.status).toBe(200); // answered while the lookup is still pending
    await new Promise((r) => setTimeout(r, 50));
    release();
    for (let i = 0; i < 50 && (await status()).albums.matched === 0; i++) await new Promise((r) => setTimeout(r, 40));
    expect((await status()).albums.matched).toBe(1);
  });

  it('carries each play\'s cover id through sessions, stats, library and the check-in preview', async () => {
    for (const [i, t] of ['Filaments', 'Sun & Moon', 'Oceanic'].entries()) await push(t, 'Group Therapy', ['Above & Beyond'], i * 300);
    await push('Loose Single', undefined, ['Someone'], 1200);
    useDeps(async () => match());
    await backfill();
    const artId = (await query(`SELECT id FROM music_albums LIMIT 1`)).rows[0].id;

    const sessionId = (await query(`SELECT id FROM music_sessions`)).rows[0].id;
    const tracks = (await request(app).get(`/api/v1/music/sessions/${sessionId}/tracks`)).body;
    expect(tracks.map((t: any) => t.art_id)).toEqual([null, artId, artId, artId]); // newest first

    const stats = (await request(app).get('/api/v1/music/stats')).body;
    expect(stats.top_songs.find((r: any) => r.name === 'Sun & Moon').art_id).toBe(artId);
    expect(stats.top_albums[0]).toMatchObject({ name: 'Group Therapy', art_id: artId });
    expect(stats.top_artists.every((r: any) => !('art_id' in r))).toBe(true);
    expect(stats.top_albums[0]).not.toHaveProperty('album_key');

    const library = (await request(app).get('/api/v1/music/library').query({ view: 'songs' })).body.rows;
    expect(library.find((r: any) => r.name === 'Loose Single').art_id).toBeNull();
    expect(library.find((r: any) => r.name === 'Oceanic').art_id).toBe(artId);
  });

  it('fills missing track lengths from the album, never overwriting, and updates session time', async () => {
    // Filaments (no length), Sun & Moon (multi-scrobbler length 100 must stay), a remastered title, a bonus track not on the album.
    await push('Filaments', 'Group Therapy');
    await request(app).post(`${BASE}/newscrobble`).send({ title: 'Sun & Moon', artists: ['Above & Beyond'], album: 'Group Therapy', time: T0 + 300, length: 100, key });
    await push('Oceanic (Remastered)', 'Group Therapy', ['Above & Beyond'], 600);
    await push('Hidden Bonus', 'Group Therapy', ['Above & Beyond'], 900);
    const secondsOf = async () => (await query('SELECT listened_seconds FROM music_sessions')).rows[0].listened_seconds;
    expect(await secondsOf()).toBe(100);

    useDeps(async () => match());
    await backfill();
    const lengths = (await query(`SELECT title, track_length FROM music_scrobbles ORDER BY played_at`)).rows;
    expect(lengths.map((r: any) => [r.title, r.track_length])).toEqual([
      ['Filaments', 300],
      ['Sun & Moon', 100], // not overwritten
      ['Oceanic (Remastered)', 250],
      ['Hidden Bonus', null],
    ]);
    expect(await secondsOf()).toBe(650);
    expect((await status()).job.durations_filled).toBe(2);
    // Library listening time now counts them.
    const library = (await request(app).get('/api/v1/music/library').query({ view: 'songs' })).body.rows;
    expect(library.find((r: any) => r.name === 'Filaments').listened_seconds).toBe(300);

    // Already-matched albums are topped up by a later run, once nothing is left to look up.
    await push('Late Arrival', 'Group Therapy', ['Above & Beyond'], 1200);
    await query(`UPDATE music_albums SET tracks = tracks || '[{"position":4,"title":"Late Arrival","length":200}]'::jsonb`);
    await backfill();
    expect((await query(`SELECT track_length FROM music_scrobbles WHERE title = 'Late Arrival'`)).rows[0].track_length).toBe(200);
  });

  describe('backup', () => {
    const exportZip = () =>
      new Promise<Buffer>((resolve, reject) => {
        request(app)
          .get('/api/v1/backup/export')
          .buffer(true)
          .parse((res: any, cb: any) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => cb(null, Buffer.concat(chunks)));
          })
          .end((err: any, res: any) => (err ? reject(err) : resolve(res.body as Buffer)));
      });
    const wipe = async () => {
      const { server } = await import('../../server');
      await server.deleteUserData!({ user_id: DEFAULT_USER_ID });
      fs.rmSync(path.join(dataDir, 'music-art'), { recursive: true, force: true });
    };
    const seed = async () => {
      await push('Sun & Moon', 'Group Therapy');
      await push('Mystery', 'Unfindable', ['Someone'], 600);
      useDeps(async (album) => (album === 'Group Therapy' ? match() : null));
      await backfill();
    };

    it('round-trips matches, tracklists and thumbnails through a ZIP backup, with no network', async () => {
      await seed();
      const zip = await exportZip();
      await wipe();
      expect((await query('SELECT 1 FROM music_albums')).rowCount).toBe(0);

      setAlbumDeps(null); // restoring must not look anything up
      const res = await request(app).post('/api/v1/backup/import').attach('file', zip, 'backup.zip').set('Content-Type', 'application/zip');
      expect(res.status).toBe(200);
      expect(res.body.errors).toHaveLength(0);

      const rows = (await query(`SELECT album_key, status, title, release_date, label, thumb_file, large_url, tracks FROM music_albums ORDER BY album_key`)).rows;
      expect(rows.map((r: any) => [r.album_key, r.status])).toEqual([
        ['group therapy|above & beyond', 'matched'],
        ['unfindable|someone', 'not_found'],
      ]);
      expect(rows[0]).toMatchObject({ title: 'Group Therapy', release_date: '2011-06-14', label: 'Anjunabeats', thumb_file: 'deezer-42-thumb.jpg', large_url: 'https://img/1000.jpg' });
      expect(rows[0].tracks.map((t: any) => [t.title, t.length])).toEqual([['Filaments', 300], ['Sun & Moon', 321], ['Oceanic', 250]]);
      expect(fs.existsSync(path.join(dataDir, 'music-art', 'deezer-42-thumb.jpg'))).toBe(true);

      const id = rows.length && (await query(`SELECT id FROM music_albums WHERE status = 'matched'`)).rows[0].id;
      expect((await request(app).get(`/api/v1/music/albums/${id}/art`)).status).toBe(200);
      expect((await request(app).get('/api/v1/music/album-view').query({ art_id: id })).body.plays).toBe(1);

      // Nothing is left to look up: the not-found result was kept too.
      finds = [];
      useDeps(async () => { throw new Error('should not be called'); });
      await backfill();
      expect(finds).toEqual([]);
    });

    it('restores from JSON alone and downloads the missing thumbnails on the next update', async () => {
      await seed();
      const { server } = await import('../../server');
      const payload = await server.backupExport!({ user_id: DEFAULT_USER_ID });
      await wipe();
      await server.backupImport!({ user_id: DEFAULT_USER_ID }, payload);
      const row = (await query(`SELECT thumb_file, thumb_url FROM music_albums WHERE status = 'matched'`)).rows[0];
      expect(row).toEqual({ thumb_file: null, thumb_url: 'https://img/250.jpg' });

      imageHits = [];
      await backfill();
      expect((await status()).job.thumbnails_restored).toBe(1);
      expect(imageHits).toEqual(['https://img/250.jpg']);
      expect((await query(`SELECT thumb_file FROM music_albums WHERE status = 'matched'`)).rows[0].thumb_file).toBe('deezer-42-thumb.jpg');
    });

    it('does not repeat a thumbnail download for a release that has no cover', async () => {
      await push('Sun & Moon', 'Group Therapy');
      useDeps(async () => match(), 404);
      await backfill();
      imageHits = [];
      await backfill();
      expect(imageHits).toEqual([]);
    });

    it('ignores malformed album rows and untrusted file names', async () => {
      const { server } = await import('../../server');
      await push('Sun & Moon', 'Group Therapy');
      await server.backupImport!({ user_id: DEFAULT_USER_ID }, {
        scrobbles: [],
        albums: [
          null,
          { album_key: 'x', status: 'matched', provider: 'evil', external_id: '1' },
          { album_key: 'y', status: 'matched', provider: 'deezer', external_id: '../../etc/passwd', title: 'T', tracks: [{ title: 'ok', length: -5 }, { nope: 1 }], has_thumb: true },
        ],
      });
      const rows = (await query(`SELECT album_key, external_id, thumb_file, tracks FROM music_albums`)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].thumb_file).toBeNull();
      expect(rows[0].tracks).toEqual([{ position: 1, title: 'ok', length: null }]);
    });
  });

  it("keeps each user's lookup run to themselves", async () => {
    const other = await createTestUser('other');
    await push('Sun & Moon', 'Group Therapy');
    let release!: () => void;
    useDeps(() => new Promise((resolve) => { release = () => resolve(match()); }));
    expect((await request(app).post('/api/v1/music/albums/backfill')).status).toBe(202);
    for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 20));

    // The other user sees no run, can't cancel the owner's, and may start their own.
    const theirs = (await request(app).get('/api/v1/music/albums/status').set('Cookie', other.cookie)).body;
    expect(theirs.job.state).toBe('idle');
    expect(theirs.albums.total).toBe(0);
    await request(app).post('/api/v1/music/albums/backfill/cancel').set('Cookie', other.cookie);
    expect((await request(app).post('/api/v1/music/albums/backfill').set('Cookie', other.cookie)).status).toBe(202);
    expect((await status()).job.state).toBe('running');

    release();
    await whenBackfillDone();
    expect((await status()).job).toMatchObject({ state: 'done', matched: 1 });
    expect((await request(app).get('/api/v1/music/albums/status').set('Cookie', other.cookie)).body.job)
      .toMatchObject({ state: 'done', matched: 0 });
  });

  it('removes albums on start-over and collects their files on the next lookup', async () => {
    await push('Sun & Moon', 'Group Therapy');
    useDeps(async () => match());
    await backfill();
    expect(fs.readdirSync(path.join(dataDir, 'music-art'))).toContain('deezer-42-thumb.jpg');
    const { server } = await import('../../server');
    await server.deleteUserData!({ user_id: DEFAULT_USER_ID });
    expect((await query('SELECT 1 FROM music_albums')).rowCount).toBe(0);
    useDeps(async () => null);
    await push('Other', 'Else', ['X'], 1000);
    // Files only just written are spared (another user's lookup may own them).
    await backfill();
    expect(fs.readdirSync(path.join(dataDir, 'music-art'))).toContain('deezer-42-thumb.jpg');
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(path.join(dataDir, 'music-art', 'deezer-42-thumb.jpg'), old, old);
    await backfill();
    expect(fs.readdirSync(path.join(dataDir, 'music-art'))).toEqual([]);
  });
});
