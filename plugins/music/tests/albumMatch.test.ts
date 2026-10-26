import { describe, expect, it } from 'vitest';
import { acceptsRelease, normalizeTitle, plausibleTitle, sameArtist, trackOverlap } from '../services/albumMatch';

const tracks = (...titles: string[]) => titles.map((title, i) => ({ position: i + 1, title, length: 200 }));

describe('normalizeTitle', () => {
  it.each([
    ['Here Comes the Sun - Remastered 2009', 'here comes the sun'],
    ['Abbey Road (Remastered)', 'abbey road'],
    ['Abbey Road (2019 Remaster)', 'abbey road'],
    ['Soma - Single', 'soma'],
    ['Rhythm & Bits', 'rhythm and bits'],
    ['Beyoncé', 'beyonce'],
    ['Cars (Original Soundtrack)', 'cars original soundtrack'],
    ['Song (feat. Guest)', 'song'],
    ['Song [ft. Guest & Other]', 'song'],
  ])('%s -> %s', (input, expected) => expect(normalizeTitle(input)).toBe(expected));
});

describe('sameArtist', () => {
  it('tolerates credit differences', () => {
    expect(sameArtist('Above & Beyond', 'Above and Beyond')).toBe(true);
    expect(sameArtist('The Beatles', 'Beatles')).toBe(true);
    expect(sameArtist('Skrillex', 'Sonny Moore')).toBe(false);
    expect(sameArtist('', 'X')).toBe(false);
  });
});

describe('acceptsRelease', () => {
  const played = { album: 'Group Therapy', artist: 'Above & Beyond', titles: ['Sun & Moon', 'Oceanic'] };

  it('needs the title to agree and a played track on the release', () => {
    expect(acceptsRelease(played, { title: 'Group Therapy', tracks: tracks('Filaments', 'Sun and Moon') })).toBe(true);
    expect(acceptsRelease(played, { title: 'Group Therapy', tracks: tracks('Filaments') })).toBe(false);
    expect(acceptsRelease(played, { title: 'Group Therapy 681 (DJ Mix)', tracks: tracks('Sun & Moon') })).toBe(false);
  });

  it('accepts a different title only on heavy tracklist overlap', () => {
    const p = { album: 'Cars (Original Soundtrack)', artist: 'Various', titles: ['A', 'B', 'C', 'D'] };
    expect(acceptsRelease(p, { title: 'Cars: Original Motion Picture Soundtrack', tracks: tracks('A', 'B', 'C', 'D', 'E') })).toBe(true);
    expect(acceptsRelease(p, { title: 'Cars 2', tracks: tracks('A', 'B', 'X', 'Y') })).toBe(false);
  });
});

describe('helpers', () => {
  it('counts distinct overlaps once', () => {
    expect(trackOverlap(['Song', 'song (remastered)', 'Other'], tracks('Song'))).toBe(1);
  });
  it('pre-filters search results by title', () => {
    expect(plausibleTitle('Group Therapy', 'Group Therapy')).toBe(true);
    expect(plausibleTitle('Group Therapy', 'Group Therapy (Deluxe Edition)')).toBe(true);
    expect(plausibleTitle('Group Therapy', 'Anjunabeats Volume 5')).toBe(false);
  });
});
