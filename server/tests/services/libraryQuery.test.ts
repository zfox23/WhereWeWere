import { describe, expect, it } from 'vitest';
import { likeText, orderBy, pageResult, parseLibraryParams } from '../../src/services/libraryQuery';

const opts = { sorts: ['name', 'plays'], defaultSort: 'plays' };

describe('parseLibraryParams', () => {
  it('falls back to the defaults', () => {
    expect(parseLibraryParams({}, opts)).toEqual({ q: '', sort: 'plays', dir: 'desc', limit: 100, offset: 0 });
  });

  it('keeps allowed values and bounds the rest', () => {
    expect(parseLibraryParams({ q: '  abba  ', sort: 'name', dir: 'asc', limit: '25', offset: '50' }, opts)).toEqual({
      q: 'abba', sort: 'name', dir: 'asc', limit: 25, offset: 50,
    });
    const wild = parseLibraryParams({ q: 'x'.repeat(500), sort: 'DROP TABLE', dir: 'sideways', limit: '99999', offset: '-4' }, opts);
    expect(wild.q).toHaveLength(200);
    expect(wild.sort).toBe('plays');
    expect(wild.dir).toBe('desc');
    expect(wild.limit).toBe(500);
    expect(wild.offset).toBe(0);
  });

  it('honours the caller\'s defaults and limits', () => {
    const p = parseLibraryParams({ limit: '900' }, { ...opts, defaultDir: 'asc', defaultLimit: 20, maxLimit: 300 });
    expect(p).toMatchObject({ dir: 'asc', limit: 300 });
    expect(parseLibraryParams({}, { ...opts, defaultLimit: 20 }).limit).toBe(20);
  });

  it('ignores non-string values (repeated query keys arrive as arrays)', () => {
    expect(parseLibraryParams({ q: ['a', 'b'], sort: ['name'] }, opts)).toMatchObject({ q: '', sort: 'plays' });
  });
});

describe('orderBy', () => {
  const sorts = { name: 'lower(g.name)', plays: 'g.plays' };
  it('puts nulls last and ends with the tiebreak', () => {
    expect(orderBy(sorts, 'plays', 'desc', 'lower(g.name)')).toBe('g.plays DESC NULLS LAST, lower(g.name)');
    expect(orderBy(sorts, 'name', 'asc', 'g.id')).toBe('lower(g.name) ASC NULLS LAST, g.id');
  });
  it('refuses a sort that is not whitelisted', () => {
    expect(() => orderBy(sorts, 'evil', 'asc', 'g.id')).toThrow();
  });
});

describe('likeText', () => {
  it('lower-cases and escapes wildcards', () => {
    expect(likeText(' 100%_Pure\\ ')).toBe('100\\%\\_pure\\\\');
  });
});

describe('pageResult', () => {
  it('moves the window count out of the rows', () => {
    expect(pageResult([{ id: 1, total: 7 }, { id: 2, total: 7 }])).toEqual({ rows: [{ id: 1 }, { id: 2 }], total: 7 });
    expect(pageResult([])).toEqual({ rows: [], total: 0 });
  });
});
