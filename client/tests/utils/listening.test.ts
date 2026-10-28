import { describe, expect, it } from 'vitest';
import { dedupeListening } from '../../src/utils/listening';
import type { ListeningBefore } from '../../src/types';

const play = (title: string, time: number) => ({ artists: ['A'], title, time });
const entry = (anchor_time: number, titles: [string, number][], session_id = 's1'): ListeningBefore => ({
  session_id,
  session_date: '2024-05-01',
  anchor_time,
  tracks: titles.map(([t, at]) => play(t, at)),
  has_more: false,
});
const titles = (l: ListeningBefore | null | undefined) => l?.tracks.map((t) => t.title) ?? null;

describe('dedupeListening', () => {
  it('keeps shared plays on the earliest check-in only', () => {
    const out = dedupeListening({
      later: entry(500, [['D', 450], ['C', 300], ['B', 200]]),
      arrival: entry(350, [['C', 300], ['B', 200], ['A', 100]]),
    });
    expect(titles(out.arrival)).toEqual(['C', 'B', 'A']);
    expect(titles(out.later)).toEqual(['D']);
  });

  it('drops a check-in whose plays were all shown already, and keeps nulls', () => {
    const out = dedupeListening({
      first: entry(300, [['B', 200], ['A', 100]]),
      second: entry(320, [['B', 200]]),
      none: null,
    });
    expect(out.second).toBeNull();
    expect(out.none).toBeUndefined();
    expect(titles(out.first)).toEqual(['B', 'A']);
  });

  it('treats the same song played at another time, or in another session, as a different play', () => {
    const out = dedupeListening({
      a: entry(300, [['Loop', 200]]),
      b: entry(900, [['Loop', 800]]),
      c: entry(300, [['Loop', 200]], 's2'),
    });
    expect([titles(out.a), titles(out.b), titles(out.c)]).toEqual([['Loop'], ['Loop'], ['Loop']]);
  });

  it('breaks ties between check-ins at the same moment by id', () => {
    const out = dedupeListening({ b: entry(300, [['X', 200]]), a: entry(300, [['X', 200]]) });
    expect(titles(out.a)).toEqual(['X']);
    expect(out.b).toBeNull();
  });
});
