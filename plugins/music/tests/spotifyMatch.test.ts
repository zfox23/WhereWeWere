import { describe, expect, it } from 'vitest';
import { looseName, normalizeName, pickAlbum, pickArtist, pickTrack, searchTerm } from '../services/spotifyMatch';
import { parsePlaylist, parsePlaylistEntry, pickImage, isSpotifyImageUrl } from '../services/spotifySync';
import { redirectUriFor } from '../services/spotifyApi';

const track = (id: string, name: string, artists: string[], album = 'Album') => ({
  id,
  name,
  type: 'track',
  artists: artists.map((a) => ({ name: a })),
  album: { name: album },
});

describe('normalizeName', () => {
  it('drops credits, remaster tags, accents and punctuation', () => {
    expect(normalizeName('Known You Before (with Emilie Brandt)')).toBe('known you before');
    expect(normalizeName('Here Comes the Sun - Remastered 2009')).toBe('here comes the sun');
    expect(normalizeName('Héroes [2017 Remaster]')).toBe('heroes');
    expect(normalizeName('Above & Beyond')).toBe('above and beyond');
  });

  it('keeps remixes and live versions apart', () => {
    expect(normalizeName('Sun & Moon (Club Mix)')).not.toBe(normalizeName('Sun & Moon'));
  });

  it('loosely, drops any bracket or dash suffix', () => {
    expect(looseName('Song - Radio Edit')).toBe('song');
    expect(looseName('Album (Deluxe Edition)')).toBe('album');
  });
});

describe('pickTrack', () => {
  it('takes the track whose title and an artist agree, preferring the same album', () => {
    const results = [
      track('a', 'Sun & Moon', ['Someone Else']),
      track('b', 'Sun & Moon', ['Above & Beyond', 'Richard Bedford'], 'Sun & Moon (Remixes)'),
      track('c', 'Sun & Moon', ['Above & Beyond', 'Richard Bedford'], 'Group Therapy'),
    ];
    expect(pickTrack(results, { title: 'Sun & Moon', artist: 'Above & Beyond', album: 'Group Therapy' })).toBe('c');
    expect(pickTrack(results, { title: 'Sun & Moon', artist: 'Above & Beyond' })).toBe('b');
  });

  it('matches a credit written differently by the scrobbler', () => {
    const results = [track('x', 'Known You Before (feat. Emilie Brandt)', ['Jason Ross', 'Seven Lions'])];
    expect(pickTrack(results, { title: 'Known You Before (with Emilie Brandt)', artist: 'Jason Ross' })).toBe('x');
  });

  it('falls back to a loose title only when nothing agrees exactly', () => {
    const results = [track('edit', 'Song - Radio Edit', ['Artist']), track('other', 'Different', ['Artist'])];
    expect(pickTrack(results, { title: 'Song', artist: 'Artist' })).toBe('edit');
  });

  it('accepts nothing by another artist, and nothing that is not a track', () => {
    expect(pickTrack([track('a', 'Song', ['Cover Band'])], { title: 'Song', artist: 'Artist' })).toBeNull();
    expect(pickTrack([{ id: 'e', name: 'Song', type: 'episode', artists: [{ name: 'Artist' }] }], { title: 'Song', artist: 'Artist' })).toBeNull();
    expect(pickTrack([], { title: 'Song', artist: 'Artist' })).toBeNull();
  });
});

describe('pickAlbum and pickArtist', () => {
  it('prefers the full album to a compilation of the same name', () => {
    const results = [
      { id: 'comp', name: 'Group Therapy', album_type: 'compilation', artists: [{ name: 'Above & Beyond' }] },
      { id: 'lp', name: 'Group Therapy', album_type: 'album', artists: [{ name: 'Above & Beyond' }] },
    ];
    expect(pickAlbum(results, { album: 'Group Therapy', artist: 'Above & Beyond' })).toBe('lp');
  });

  it('matches a deluxe edition only loosely', () => {
    const results = [{ id: 'dlx', name: 'Album (Deluxe Edition)', album_type: 'album', artists: [{ name: 'A' }] }];
    expect(pickAlbum(results, { album: 'Album', artist: 'A' })).toBe('dlx');
    expect(pickAlbum(results, { album: 'Album', artist: 'B' })).toBeNull();
  });

  it('takes an artist only by their exact name', () => {
    expect(pickArtist([{ id: '1', name: 'Above & Beyond Tribute' }, { id: '2', name: 'Above and Beyond' }], 'Above & Beyond')).toBe('2');
    expect(pickArtist([{ id: '1', name: 'Someone' }], 'Above & Beyond')).toBeNull();
  });

  it('makes search terms without quotes or credits', () => {
    expect(searchTerm('Say "Hi" (feat. X)')).toBe('Say Hi');
  });
});

describe('reading playlists', () => {
  it('reads the February 2026 shape (items/item) and the older one (tracks/track)', () => {
    expect(parsePlaylist({ id: 'p1', name: 'Mine', owner: { id: 'me', display_name: 'Me' }, items: { total: 3 }, snapshot_id: 's' })).toMatchObject({
      spotify_id: 'p1',
      owner_name: 'Me',
      total_tracks: 3,
      snapshot_id: 's',
    });
    expect(parsePlaylist({ id: 'p2', name: 'Old', tracks: { total: 7 } })?.total_tracks).toBe(7);
    expect(parsePlaylist({ name: 'No id' })).toBeNull();
  });

  it('takes the track from `item`, ignoring a boolean `track`', () => {
    const entry = {
      added_at: '2024-05-01T12:00:00Z',
      track: true,
      item: { id: 't1', type: 'track', name: 'Song', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'LP' }, duration_ms: 200000 },
    };
    expect(parsePlaylistEntry(entry)).toEqual({
      spotify_id: 't1',
      title: 'Song',
      artists: ['A', 'B'],
      album: 'LP',
      duration_ms: 200000,
      added_at: '2024-05-01T12:00:00Z',
      is_local: false,
    });
    expect(parsePlaylistEntry({ track: { id: 't2', name: 'Old', artists: [{ name: 'A' }] } })?.spotify_id).toBe('t2');
  });

  it('skips episodes and removed tracks; local files have no Spotify id; epoch dates are unknown', () => {
    expect(parsePlaylistEntry({ item: { type: 'episode', name: 'Pod' } })).toBeNull();
    expect(parsePlaylistEntry({ item: null, track: null })).toBeNull();
    const local = parsePlaylistEntry({ is_local: true, added_at: '1970-01-01T00:00:00Z', item: { id: 'x', name: 'Demo', artists: [] } });
    expect(local).toMatchObject({ spotify_id: null, is_local: true, added_at: null, artists: [] });
  });

  it('picks a cover near 160px from Spotify hosts only', () => {
    expect(
      pickImage([
        { url: 'https://i.scdn.co/640', width: 640 },
        { url: 'https://i.scdn.co/300', width: 300 },
        { url: 'https://i.scdn.co/60', width: 60 },
      ]),
    ).toBe('https://i.scdn.co/300');
    expect(pickImage([{ url: 'https://mosaic.scdn.co/m', width: null }])).toBe('https://mosaic.scdn.co/m');
    expect(pickImage(null)).toBeNull();
    expect(isSpotifyImageUrl('https://i.scdn.co/image/x')).toBe(true);
    expect(isSpotifyImageUrl('https://image-cdn-ak.spotifycdn.com/image/x')).toBe(true);
    expect(isSpotifyImageUrl('https://evil.example/scdn.co')).toBe(false);
    expect(isSpotifyImageUrl('http://i.scdn.co/x')).toBe(false);
  });
});

describe('redirectUriFor', () => {
  it('builds the callback on the app origin, and refuses anything else', () => {
    expect(redirectUriFor('https://www.example.com')).toBe('https://www.example.com/api/v1/music/spotify/callback');
    expect(redirectUriFor('https://www.example.com/some/page?x')).toBe('https://www.example.com/api/v1/music/spotify/callback');
    expect(redirectUriFor('javascript:alert(1)')).toBeNull();
    expect(redirectUriFor(42)).toBeNull();
  });
});
