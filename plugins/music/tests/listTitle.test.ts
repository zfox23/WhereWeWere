import { describe, expect, it } from 'vitest';
import { topListTitle } from '../ui/listTitle';

describe('topListTitle', () => {
  it.each([
    ['2026-01-01', '2026-01-31', 'albums', '2026-01 Most Listened Albums'],
    ['2026-02-01', '2026-02-28', 'songs', '2026-02 Most Listened Songs'],
    ['2024-02-01', '2024-02-29', 'songs', '2024-02 Most Listened Songs'], // leap year
    ['2026-01-01', '2026-03-31', 'albums', '2026-01 - 2026-03 Most Listened Albums'],
    ['2025-11-01', '2026-01-31', 'songs', '2025-11 - 2026-01 Most Listened Songs'],
    ['2025-04-01', '2026-03-31', 'albums', '2025-04 - 2026-03 Most Listened Albums'],
    ['2026-01-05', '2026-01-11', 'songs', '2026-01-05 - 2026-01-11 Most Listened Songs'],
    ['2026-01-03', '2026-01-03', 'songs', '2026-01-03 Most Listened Songs'],
    ['2026-01-02', '2026-01-31', 'albums', '2026-01-02 - 2026-01-31 Most Listened Albums'],
    ['', '', 'albums', 'All Time Most Listened Albums'],
    ['nope', '2026-01-31', 'songs', 'All Time Most Listened Songs'],
  ] as const)('%s to %s (%s) -> %s', (from, to, kind, expected) => {
    expect(topListTitle(from, to, kind)).toBe(expected);
  });
});
