import { describe, expect, it } from 'vitest';
import { parseCsv, parseLastfmCsv } from '../services/lastfmCsv';

const HEADER = 'uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid';

const SAMPLE = [
  HEADER,
  '"1789661639","17 Sep 2026, 16:13","Melodysheep","01b2e661","The Music of Sound","04a5bc29","I Wonder","76168144"',
  '"1789661450","17 Sep 2026, 16:10","The Beatles","b10bbbfc","Abbey Road (Remastered)","","Here Comes the Sun - Remastered 2009","cadd11ae"',
  '"1789661266","17 Sep 2026, 16:07","Cars on the Road - Cast","","Cars on the Road (Original Soundtrack)","","TRUCKS",""',
  '"1789652376","17 Sep 2026, 13:39","Rhythm & Bits","","GUILE\'S THEME","","GUILE\'S THEME",""',
].join('\n');

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, embedded commas/newlines, CRLF and a BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, ""y""","line1\nline2"\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'line1\nline2'],
    ]);
  });
});

describe('parseLastfmCsv', () => {
  it('keeps each artist credit whole', () => {
    const { scrobbles, skipped } = parseLastfmCsv(SAMPLE);
    expect(skipped).toBe(0);
    expect(scrobbles).toHaveLength(4);
    expect(scrobbles[3]).toEqual({
      playedAt: new Date(1789652376 * 1000),
      title: "GUILE'S THEME",
      artists: ['Rhythm & Bits'],
      album: "GUILE'S THEME",
      albumArtists: ['Rhythm & Bits'],
      source: 'lastfm',
    });
    expect(scrobbles[1].title).toBe('Here Comes the Sun - Remastered 2009');
  });

  it('stores a missing album as null', () => {
    const { scrobbles } = parseLastfmCsv(`${HEADER}\n"1700000000","x","Above & Beyond","","","","Sun & Moon",""`);
    expect(scrobbles[0]).toMatchObject({ artists: ['Above & Beyond'], album: null, albumArtists: [] });
  });

  it('counts unreadable rows and rejects other files', () => {
    const { scrobbles, skipped } = parseLastfmCsv(`${HEADER}\n"x","","A","","","","T",""\n"1700000000","","","","","","T",""\n"1700000001","","A","","","","T",""`);
    expect(scrobbles).toHaveLength(1);
    expect(skipped).toBe(2);
    expect(() => parseLastfmCsv('a,b\n1,2')).toThrow('Not a Last.fm CSV export');
    expect(() => parseLastfmCsv(HEADER)).toThrow('No scrobbles found in file');
  });
});
