import { describe, expect, it } from 'vitest';
import { cleanGenreList, musicBrainzGenres, normalizeGenre, pickGenres } from '../services/genreProviders';
import type { MusicBrainzGet } from '../services/albumProviders';

const RG1 = '11111111-1111-1111-1111-111111111111';
const RG2 = '22222222-2222-2222-2222-222222222222';
const AR1 = '33333333-3333-3333-3333-333333333333';

/** A fake client: answers by path, recording each request. */
function fake(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const get: MusicBrainzGet = async (path, params) => {
    calls.push(params.query ? `${path}?${params.query}` : path);
    return (routes[path] ?? null) as any;
  };
  return { get, calls };
}

const credit = (name: string) => [{ name, joinphrase: '' }];

describe('genre names', () => {
  it('are lower-case and single-spaced; empty or overlong ones are dropped', () => {
    expect(normalizeGenre('  Progressive   House ')).toBe('progressive house');
    expect(normalizeGenre('')).toBeNull();
    expect(normalizeGenre('x'.repeat(61))).toBeNull();
    expect(normalizeGenre(42)).toBeNull();
    expect(cleanGenreList(['Trance', 'trance', ' ', 'House', 'Techno'], 2)).toEqual(['trance', 'house']);
    expect(cleanGenreList('trance')).toEqual([]);
  });
});

describe('pickGenres', () => {
  it('keeps genres with at least a third of the top votes, most votes first', () => {
    expect(
      pickGenres([
        { name: 'pop', count: 1 },
        { name: 'Trance', count: 9 },
        { name: 'progressive trance', count: 3 },
        { name: 'house', count: 2 },
      ]),
    ).toEqual(['trance', 'progressive trance']);
  });

  it('keeps every genre when all have one vote, up to six', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({ name, count: 1 }));
    expect(pickGenres(many)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('is empty for nothing usable', () => {
    expect(pickGenres(undefined)).toEqual([]);
    expect(pickGenres([{ name: '', count: 4 }, { name: 'x', count: 0 }])).toEqual([]);
  });
});

describe('musicBrainzGenres', () => {
  it('finds an album’s release group by title and artist and reads its genres', async () => {
    const { get, calls } = fake({
      '/release-group': {
        'release-groups': [
          { id: RG2, title: 'Group Therapy (Live)', 'artist-credit': credit('Above & Beyond') },
          { id: 'x', title: 'Group Therapy', 'artist-credit': credit('Someone Else') },
          { id: RG1, title: 'Group Therapy', 'artist-credit': credit('Above & Beyond') },
        ],
      },
      [`/release-group/${RG1}`]: { genres: [{ name: 'trance', count: 4 }, { name: 'progressive trance', count: 2 }] },
    });
    const match = await musicBrainzGenres(get).album({ album: 'Group Therapy', artist: 'Above & Beyond' });
    expect(match).toEqual({ mbid: RG1, genres: ['trance', 'progressive trance'] });
    // The live album and someone else's are never read.
    expect(calls).toEqual([`/release-group?releasegroup:"Group Therapy" AND artist:"Above & Beyond"`, `/release-group/${RG1}`]);
  });

  it('tries the next candidate when the first has no genres, and reports a known album with none', async () => {
    const twoUntagged = fake({
      '/release-group': {
        'release-groups': [
          { id: RG1, title: 'Album', 'artist-credit': credit('Band') },
          { id: RG2, title: 'Album', 'artist-credit': credit('Band') },
        ],
      },
      [`/release-group/${RG1}`]: { genres: [] },
      [`/release-group/${RG2}`]: { genres: [{ name: 'rock', count: 1 }] },
    });
    expect(await musicBrainzGenres(twoUntagged.get).album({ album: 'Album', artist: 'Band' })).toEqual({ mbid: RG2, genres: ['rock'] });

    const untagged = fake({
      '/release-group': { 'release-groups': [{ id: RG1, title: 'Album', 'artist-credit': credit('Band') }] },
      [`/release-group/${RG1}`]: { genres: [] },
    });
    expect(await musicBrainzGenres(untagged.get).album({ album: 'Album', artist: 'Band' })).toEqual({ mbid: RG1, genres: [] });
  });

  it('accepts a Various Artists compilation and finds nothing for an unknown album', async () => {
    const va = fake({
      '/release-group': { 'release-groups': [{ id: RG1, title: 'Anjunabeats Vol. 1', 'artist-credit': credit('Various Artists') }] },
      [`/release-group/${RG1}`]: { genres: [{ name: 'trance', count: 1 }] },
    });
    expect((await musicBrainzGenres(va.get).album({ album: 'Anjunabeats Vol. 1', artist: 'Above & Beyond' }))?.genres).toEqual(['trance']);
    expect(await musicBrainzGenres(fake({}).get).album({ album: 'Nope', artist: 'Nobody' })).toBeNull();
  });

  it('finds an artist by name or alias, ignoring namesakes that differ', async () => {
    const { get, calls } = fake({
      '/artist': {
        artists: [
          { id: 'y', name: 'Above and Beyond Choir' },
          { id: AR1, name: 'Above & Beyond', aliases: [{ name: 'A&B' }] },
        ],
      },
      [`/artist/${AR1}`]: { genres: [{ name: 'Trance', count: 12 }, { name: 'progressive house', count: 5 }] },
    });
    expect(await musicBrainzGenres(get).artist('above and beyond')).toEqual({ mbid: AR1, genres: ['trance', 'progressive house'] });
    expect(calls).toEqual(['/artist?artist:"above and beyond"', `/artist/${AR1}`]);
    expect(await musicBrainzGenres(get).artist('A&B')).toEqual({ mbid: AR1, genres: ['trance', 'progressive house'] });
    expect(await musicBrainzGenres(get).artist('Unrelated')).toBeNull();
  });
});
