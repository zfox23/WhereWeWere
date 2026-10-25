import { describe, expect, it } from 'vitest';
import { parseScrobbleExport } from '../services/importParser';

const entry = (overrides: Record<string, unknown> = {}) => ({
  time: 1714564800,
  track: {
    artists: ['A', 'B'],
    title: 'Song',
    album: { albumtitle: 'Album', artists: ['A'] },
    length: 200,
  },
  duration: 180,
  origin: 'client:spotify',
  ...overrides,
});

describe('parseScrobbleExport', () => {
  it('reads a Maloja export', () => {
    const { scrobbles, skipped } = parseScrobbleExport(
      JSON.stringify({ maloja: { version: '3.2.9' }, scrobbles: [entry()] }),
    );
    expect(skipped).toBe(0);
    expect(scrobbles).toEqual([{
      playedAt: new Date(1714564800 * 1000),
      title: 'Song',
      artists: ['A', 'B'],
      album: 'Album',
      albumArtists: ['A'],
      trackLength: 200,
      listenedFor: 180,
      source: 'import',
    }]);
  });

  it('accepts a bare array and string or missing albums', () => {
    const { scrobbles } = parseScrobbleExport(JSON.stringify([
      entry({ track: { artists: ['A'], title: 'One', album: 'Plain' } }),
      entry({ track: { artists: ['A'], title: 'Two', album: null } }),
      entry({ track: { artists: ['A'], title: 'Three' }, duration: undefined }),
    ]));
    expect(scrobbles.map((s) => [s.title, s.album, s.listenedFor])).toEqual([
      ['One', 'Plain', 180],
      ['Two', null, 180],
      ['Three', null, null],
    ]);
  });

  it('counts unreadable rows instead of failing', () => {
    const { scrobbles, skipped } = parseScrobbleExport(JSON.stringify({
      scrobbles: [
        entry(),
        entry({ time: 'x' }),
        entry({ track: { artists: [], title: 'No artists' } }),
        entry({ track: { artists: ['A'] } }),
        null,
      ],
    }));
    expect(scrobbles).toHaveLength(1);
    expect(skipped).toBe(4);
  });

  it('rejects files that are not scrobble exports', () => {
    expect(() => parseScrobbleExport('not json')).toThrow('File is not valid JSON');
    expect(() => parseScrobbleExport('{"tracks": []}')).toThrow('No scrobbles found in file');
  });
});
