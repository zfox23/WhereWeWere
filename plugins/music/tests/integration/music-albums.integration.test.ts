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

describe('album artwork', () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#c33' } }).png().toBuffer();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-art-'));
    config.dataDir = dataDir;
  });
  beforeEach(async () => {
    await resetIntegrationDatabase();
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
    await push('New', 'Fresh', ['Someone'], 900);
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

  it('stops without recording anything when a catalog is unavailable', async () => {
    await push('Sun & Moon', 'Group Therapy');
    useDeps(async () => { throw new ProviderUnavailableError('Deezer is rate limiting requests'); });
    await backfill();
    const s = await status();
    expect(s.job).toMatchObject({ state: 'error', error: 'Deezer is rate limiting requests' });
    expect(s.albums).toMatchObject({ pending: 1, matched: 0, not_found: 0 });
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
    const res = await request(app).get(`/api/v1/music/albums/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Group Therapy', artist: 'Above & Beyond', release_date: '2011-06-14', label: 'Anjunabeats', plays: 4 });
    expect(res.body.tracks.map((t: any) => [t.title, t.length, t.plays])).toEqual([
      ['Filaments', 300, 1],
      ['Sun & Moon', 321, 2],
      ['Oceanic', 250, 1],
    ]);
    expect((await request(app).get('/api/v1/music/albums/not-a-uuid')).status).toBe(400);
    expect((await request(app).get('/api/v1/music/albums/00000000-0000-4000-8000-000000000000')).status).toBe(404);
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
    await backfill();
    expect(fs.readdirSync(path.join(dataDir, 'music-art'))).toEqual([]);
  });
});
