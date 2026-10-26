import { describe, expect, it, vi } from 'vitest';
import {
  chainProviders,
  createDeezerProvider,
  createMusicBrainzProvider,
  ProviderUnavailableError,
  type FetchLike,
} from '../services/albumProviders';

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const played = { album: 'Group Therapy', artist: 'Above & Beyond', titles: ['Sun & Moon'] };

const deezerAlbum = {
  id: 42,
  title: 'Group Therapy',
  release_date: '2011-06-14',
  label: 'Anjunabeats',
  nb_tracks: 2,
  artist: { name: 'Above & Beyond' },
  cover_medium: 'https://cdn/250.jpg',
  cover_xl: 'https://cdn/1000.jpg',
  tracks: { data: [{ title: 'Filaments', duration: 300, track_position: 1 }, { title: 'Sun & Moon', duration: 321, track_position: 2 }] },
};

function deezerFetch(routes: Record<string, unknown>): FetchLike & ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    return json(routes[path] ?? { error: { code: 800, message: 'no data' } });
  });
}

describe('Deezer provider', () => {
  it('finds, verifies and maps an album', async () => {
    const fetchImpl = deezerFetch({
      '/search/album': { data: [{ id: 7, title: 'Group Therapy 681 (DJ Mix)', artist: { name: 'x' } }, { id: 42, title: 'Group Therapy', artist: { name: 'Above & Beyond' } }] },
      '/album/42': deezerAlbum,
    });
    const match = await createDeezerProvider(fetchImpl, 0).find(played);
    expect(match).toEqual({
      provider: 'deezer',
      externalId: '42',
      title: 'Group Therapy',
      artist: 'Above & Beyond',
      releaseDate: '2011-06-14',
      label: 'Anjunabeats',
      tracks: [
        { position: 1, title: 'Filaments', length: 300 },
        { position: 2, title: 'Sun & Moon', length: 321 },
      ],
      thumbUrl: 'https://cdn/250.jpg',
      largeUrl: 'https://cdn/1000.jpg',
    });
    // The DJ mix was never worth a tracklist request.
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes('/album/7'))).toBe(false);
  });

  it('rejects a same-titled album without the played tracks, then tries album-only search', async () => {
    const wrong = { ...deezerAlbum, id: 9, tracks: { data: [{ title: 'Other', duration: 100 }] }, nb_tracks: 1 };
    const fetchImpl = deezerFetch({
      '/search/album': { data: [{ id: 9, title: 'Group Therapy', artist: { name: 'Above & Beyond' } }] },
      '/album/9': wrong,
    });
    expect(await createDeezerProvider(fetchImpl, 0).find(played)).toBeNull();
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes('/search/album'))).toHaveLength(2);
  });

  it('pages a tracklist that was cut short', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === '/search/album') return json({ data: [{ id: 42, title: 'Group Therapy', artist: { name: 'Above & Beyond' } }] });
      if (u.pathname === '/album/42') return json({ ...deezerAlbum, nb_tracks: 3, tracks: { data: [deezerAlbum.tracks.data[0]] } });
      if (u.pathname === '/album/42/tracks') return json({ data: [deezerAlbum.tracks.data[1], { title: 'Third', duration: 5 }] });
      return json({ error: { code: 800 } });
    });
    const match = await createDeezerProvider(fetchImpl, 0).find(played);
    expect(match?.tracks.map((t) => t.title)).toEqual(['Filaments', 'Sun & Moon', 'Third']);
  });

  it('treats an error body on HTTP 200 as unavailable', async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: 100, message: 'Items limit' } }));
    await expect(createDeezerProvider(fetchImpl, 0).find(played)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('reports network failures as unavailable', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    await expect(createDeezerProvider(fetchImpl, 0).find(played)).rejects.toThrow(/Couldn't reach Deezer/);
  });
});

describe('MusicBrainz provider', () => {
  const release = {
    id: 'mbid-1',
    title: 'Group Therapy',
    date: '2011-06-14',
    'label-info': [{ label: { name: 'Anjunabeats' } }],
    'artist-credit': [{ name: 'Above & Beyond', joinphrase: '' }],
    media: [{ tracks: [{ title: 'Sun & Moon', length: 321000 }, { title: 'Oceanic', length: null }] }],
  };

  it('maps a release and sends a descriptive User-Agent', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      new URL(url).pathname.endsWith('/release')
        ? json({ releases: [{ id: 'mbid-1', title: 'Group Therapy' }] })
        : json(release));
    const match = await createMusicBrainzProvider(fetchImpl, 0).find(played);
    expect(match).toMatchObject({
      provider: 'musicbrainz',
      externalId: 'mbid-1',
      label: 'Anjunabeats',
      releaseDate: '2011-06-14',
      thumbUrl: 'https://coverartarchive.org/release/mbid-1/front-250',
      largeUrl: 'https://coverartarchive.org/release/mbid-1/front-1200',
    });
    expect(match?.tracks).toEqual([
      { position: 1, title: 'Sun & Moon', length: 321 },
      { position: 2, title: 'Oceanic', length: null },
    ]);
    const headers = (fetchImpl.mock.calls[0] as any)[1].headers;
    expect(headers['User-Agent']).toMatch(/WhereWeWere\/1\.0 \(https:\/\/github\.com\//);
  });
});

describe('chainProviders', () => {
  it('falls through to the next provider', async () => {
    const none = { find: async () => null };
    const some = { find: async () => ({ externalId: 'x' }) as any };
    expect((await chainProviders([none, some]).find(played))?.externalId).toBe('x');
    expect(await chainProviders([none]).find(played)).toBeNull();
  });
});
