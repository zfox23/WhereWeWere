import { describe, it, expect, vi } from 'vitest';
import {
  chunkByBudget,
  condenseUntilFits,
  buildChronologicalEntries,
  formatDateRange,
  mergeCounts,
  DEFAULT_TOKEN_CONFIG,
  MAX_CONDENSE_LEVELS,
  type Chunk,
  type LifeEntry,
} from '../../src/services/llmCompaction';

function entry(timestamp: string, label: string, line: string): LifeEntry {
  return { timestamp, label, lines: [line] };
}

describe('chunkByBudget', () => {
  it('returns no chunks for empty input', () => {
    expect(chunkByBudget([], 100)).toEqual([]);
  });

  it('keeps everything in one chunk when it fits', () => {
    const entries = [
      entry('2026-01-01T10:00:00Z', 'mood check-ins', 'a'),
      entry('2026-01-02T10:00:00Z', 'mood check-ins', 'b'),
    ];
    const chunks = chunkByBudget(entries, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('a\nb');
    expect(chunks[0].from).toBe('2026-01-01T10:00:00Z');
    expect(chunks[0].to).toBe('2026-01-02T10:00:00Z');
    expect(chunks[0].counts).toEqual({ 'mood check-ins': 2 });
  });

  it('splits into contiguous chunks, each fitting the budget', () => {
    // 5 entries of 20 chars each; budget 50 → at most 2 per chunk (20+1+20=41).
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry(`2026-01-0${i + 1}T00:00:00Z`, 'location check-ins', 'x'.repeat(20))
    );
    const chunks = chunkByBudget(entries, 50);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(50);
    }
    // Chronological order preserved across chunks.
    const allText = chunks.flatMap((c) => c.text.split('\n'));
    expect(allText.length).toBe(5);
  });

  it('never reverses chronological order', () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      entry(`2026-01-01T${String(i).padStart(2, '0')}:00:00Z`, 'tracks', `track ${i}`)
    );
    const chunks = chunkByBudget(entries, 30);
    let lastTimestamp = '';
    for (const chunk of chunks) {
      expect(chunk.from >= lastTimestamp).toBe(true);
      lastTimestamp = chunk.to;
    }
    // Every entry appears exactly once.
    const allLines = chunks.flatMap((c) => c.text.split('\n'));
    expect(allLines).toHaveLength(50);
  });

  it('isolates and truncates a single oversized entry', () => {
    const huge = 'y'.repeat(1000);
    const entries = [
      entry('2026-01-01T00:00:00Z', 'mood check-ins', 'a'),
      entry('2026-01-02T00:00:00Z', 'mood check-ins', huge),
      entry('2026-01-03T00:00:00Z', 'mood check-ins', 'b'),
    ];
    const chunks = chunkByBudget(entries, 100);
    // a | huge (truncated) | b
    expect(chunks).toHaveLength(3);
    expect(chunks[1].text.length).toBeLessThanOrEqual(100);
    expect(chunks[1].text.endsWith('…')).toBe(true);
  });

  it('tracks per-label counts per chunk', () => {
    const entries = [
      entry('2026-01-01T00:00:00Z', 'mood check-ins', 'm1'),
      entry('2026-01-02T00:00:00Z', 'location check-ins', 'l1'),
      entry('2026-01-03T00:00:00Z', 'mood check-ins', 'm2'),
    ];
    const chunks = chunkByBudget(entries, 100);
    expect(chunks[0].counts).toEqual({ 'mood check-ins': 2, 'location check-ins': 1 });
  });

  it('does not drop entries at the flush boundary', () => {
    // 3 entries of exactly 10 chars, budget 21 → 2 per chunk (10+1+10=21).
    const entries = Array.from({ length: 3 }, (_, i) =>
      entry(`2026-01-0${i + 1}T00:00:00Z`, 'sleep entries', 'z'.repeat(10))
    );
    const chunks = chunkByBudget(entries, 21);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].counts).toEqual({ 'sleep entries': 2 });
    expect(chunks[1].counts).toEqual({ 'sleep entries': 1 });
  });
});

describe('condenseUntilFits', () => {
  it('returns items as-is when they already fit', async () => {
    const items: Chunk[] = [
      { from: 'a', to: 'b', text: 'short', counts: { x: 1 } },
    ];
    const digest = vi.fn();
    const result = await condenseUntilFits(items, 100, digest);
    expect(result.text).toBe('short');
    expect(result.level).toBe(0);
    expect(result.chunks).toBe(1);
    expect(digest).not.toHaveBeenCalled();
  });

  it('digests reduced chunks when over budget (level 1)', async () => {
    // 3 items of 49 chars: 2 pack into one chunk (49+1+49=99 ≤ 100).
    const items: Chunk[] = [
      { from: 'a', to: 'b', text: 'x'.repeat(49), counts: { x: 1 } },
      { from: 'c', to: 'd', text: 'y'.repeat(49), counts: { x: 1 } },
      { from: 'e', to: 'f', text: 'z'.repeat(49), counts: { x: 1 } },
    ];
    const digest = vi.fn(async () => 'condensed');
    const result = await condenseUntilFits(items, 100, digest);
    expect(result.level).toBe(1);
    expect(result.text).toBe('condensed\n\ncondensed');
    expect(digest).toHaveBeenCalledTimes(2); // 3 chunks → 2 re-chunked digests
  });

  it('recurses to level 2 when digests still overflow', async () => {
    // 9 items of 300 chars, budget 950: level 1 packs 3+3+3 → 3 digests of
    // 400 chars (total 1200 > 950); level 2 packs 2+1 → 2 digests of 400
    // (total 800 ≤ 950) → stop.
    const items: Chunk[] = Array.from({ length: 9 }, (_, i) => ({
      from: `f${i}`,
      to: `t${i}`,
      text: 'x'.repeat(300),
      counts: { x: 1 },
    }));
    const digest = vi.fn(async () => 'd'.repeat(400));
    const result = await condenseUntilFits(items, 950, digest);
    expect(result.level).toBe(2);
    expect(digest).toHaveBeenCalledTimes(5); // 3 at level 1 + 2 at level 2
    expect(result.text.length).toBe(802); // two 400-char digests + '\n\n'
  });

  it('digests 1:1 when no items pack together, and stops once they fit', async () => {
    // 3 items of 80 chars, budget 100: re-chunking yields 3 chunks (nothing
    // packs). Each is digested 1:1, and the short digests fit → level 1.
    const items: Chunk[] = [
      { from: 'a', to: 'b', text: 'x'.repeat(80), counts: { x: 1 } },
      { from: 'c', to: 'd', text: 'y'.repeat(80), counts: { x: 1 } },
      { from: 'e', to: 'f', text: 'z'.repeat(80), counts: { x: 1 } },
    ];
    const digest = vi.fn(async () => 'condensed');
    const result = await condenseUntilFits(items, 100, digest);
    expect(digest).toHaveBeenCalledTimes(3);
    expect(result.level).toBe(1);
    expect(result.text).toBe('condensed\n\ncondensed\n\ncondensed');
  });

  it('never digests a single item (nothing to condense)', async () => {
    const items: Chunk[] = [
      { from: 'a', to: 'b', text: 'x'.repeat(1000), counts: { x: 1 } },
    ];
    const digest = vi.fn(async () => 'd'.repeat(1000));
    const result = await condenseUntilFits(items, 100, digest);
    expect(result.level).toBe(0); // never digested
    expect(digest).not.toHaveBeenCalled();
    expect(result.text.length).toBe(1000);
  });

  it('is bounded by MAX_CONDENSE_LEVELS even if digests stay large', async () => {
    // Tiny budget: oversized items are isolated+truncated each pass, but
    // the mock digests stay at 50 chars, so it never fits and must stop at
    // the hard cap instead of looping forever.
    const items: Chunk[] = [
      { from: 'a', to: 'b', text: 'x'.repeat(50), counts: { x: 1 } },
      { from: 'c', to: 'd', text: 'y'.repeat(50), counts: { x: 1 } },
    ];
    const digest = vi.fn(async () => 'd'.repeat(50));
    const result = await condenseUntilFits(items, 10, digest);
    expect(result.level).toBe(MAX_CONDENSE_LEVELS);
    expect(digest).toHaveBeenCalledTimes(2 * MAX_CONDENSE_LEVELS); // 2 items × cap levels
  });
});

describe('buildChronologicalEntries', () => {
  it('interleaves all types chronologically and reports totals', async () => {
    const rows = (label: string, times: string[]) =>
      times.map((t) => ({ checked_in_at: t, timezone: null, data: {} }));
    const { entries, totals } = await buildChronologicalEntries([
      {
        label: 'location check-ins',
        rows: rows('location', ['2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z']),
        hook: {
          label: 'location check-ins',
          gather: async () => [],
          toLines: (row) => [row.checked_in_at],
        },
      },
      {
        label: 'mood check-ins',
        rows: rows('mood', ['2026-01-02T00:00:00Z']),
        hook: {
          label: 'mood check-ins',
          gather: async () => [],
          toLines: (row) => [row.checked_in_at],
        },
      },
    ]);
    expect(entries.map((e) => e.label)).toEqual([
      'location check-ins',
      'mood check-ins',
      'location check-ins',
    ]);
    expect(totals).toEqual({ 'location check-ins': 2, 'mood check-ins': 1 });
  });

  it('handles Date-typed timestamps from the pg driver', async () => {
    // pg returns timestamptz columns as Date objects, not strings.
    const { entries, totals } = await buildChronologicalEntries([
      {
        label: 'location check-ins',
        rows: [
          { checked_in_at: new Date('2026-01-03T00:00:00Z'), timezone: null, data: {} },
          { checked_in_at: new Date('2026-01-01T00:00:00Z'), timezone: null, data: {} },
        ],
        hook: {
          label: 'location check-ins',
          gather: async () => [],
          toLines: (row) => [row.checked_in_at instanceof Date ? row.checked_in_at.toISOString() : row.checked_in_at],
        },
      },
    ]);
    expect(totals).toEqual({ 'location check-ins': 2 });
    // Chronological order despite Date input and out-of-order rows.
    expect(entries[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(entries[1].timestamp).toBe('2026-01-03T00:00:00.000Z');
  });

  it('skips entries whose toLines returned nothing', async () => {
    const { entries } = await buildChronologicalEntries([
      {
        label: 'mood check-ins',
        rows: [{ checked_in_at: '2026-01-01T00:00:00Z', timezone: null, data: {} }],
        hook: {
          label: 'mood check-ins',
          gather: async () => [],
          toLines: () => [],
        },
      },
    ]);
    expect(entries).toHaveLength(0);
  });
});

describe('formatDateRange', () => {
  it('collapses identical local dates (same-day times)', () => {
    // 8am + 6h local time fall on the same calendar day in every timezone.
    const same = new Date('2026-05-01T08:00:00');
    const sameNext = new Date(same);
    sameNext.setHours(same.getHours() + 6);
    expect(formatDateRange(same.toISOString(), sameNext.toISOString())).toBe('May 1, 2026');
  });

  it('spans distinct local dates', () => {
    const start = new Date('2026-05-01T12:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + 2);
    expect(formatDateRange(start.toISOString(), end.toISOString())).toBe('May 1, 2026 – May 3, 2026');
  });
});

describe('mergeCounts', () => {
  it('sums counts across chunks per label', () => {
    const merged = mergeCounts([
      { from: 'a', to: 'b', text: '', counts: { mood: 2, location: 1 } },
      { from: 'c', to: 'd', text: '', counts: { mood: 3 } },
    ]);
    expect(merged).toEqual({ mood: 5, location: 1 });
  });
});

describe('DEFAULT_TOKEN_CONFIG', () => {
  it('has sensible values', () => {
    expect(DEFAULT_TOKEN_CONFIG.charsPerToken).toBeGreaterThan(0);
    expect(DEFAULT_TOKEN_CONFIG.inputWindowFraction).toBeLessThan(1);
    expect(DEFAULT_TOKEN_CONFIG.digestOutputFraction).toBeLessThan(1);
  });
});
