/**
 * Notes import planning (pure): filename dates and titles, the modified-time
 * vs 8pm rule, history vs fallback zones, and duplicate flags.
 */

import { describe, expect, it } from 'vitest';
import {
  baseName,
  bodyHash,
  decodeText,
  markDuplicates,
  parseDatePrefix,
  parseImportMeta,
  planImportRow,
} from '../services/importNotes';
import type { TimezoneAnchor } from '../../../server/src/services/timezoneAnchors';

const TOKYO: TimezoneAnchor[] = [{ at: Date.parse('2017-01-01T00:00:00Z'), timezone: 'Asia/Tokyo' }];
const NOW = Date.parse('2026-10-29T12:00:00Z');

function plan(name: string, lastModified: number | null, opts: { text?: string; anchors?: TimezoneAnchor[]; fallback?: string } = {}) {
  return planImportRow({
    index: 0,
    meta: { name, lastModified },
    text: opts.text ?? 'Some words.\n',
    anchors: opts.anchors ?? [],
    fallbackTimezone: opts.fallback ?? 'America/Chicago',
    now: NOW,
  });
}

describe('filename parsing', () => {
  it('strips folders and the extension', () => {
    expect(baseName('notes/2017/2017-10-15 Night with Jason.md')).toBe('2017-10-15 Night with Jason');
    expect(baseName('C:\\x\\a.b.txt')).toBe('a.b');
  });

  it('reads a real date prefix only', () => {
    expect(parseDatePrefix('2017-10-15 Night')).toMatchObject({ date: '2017-10-15', rest: ' Night' });
    expect(parseDatePrefix('2017-02-30 Nope')).toBeNull();
    expect(parseDatePrefix('2017-10-150')).toBeNull();
    expect(parseDatePrefix('Night 2017-10-15')).toBeNull();
  });
});

describe('planImportRow', () => {
  it('uses the modified time when it falls on the filename date', () => {
    // 2017-10-15 22:30 in Chicago (CDT, UTC-5).
    const modified = Date.parse('2017-10-16T03:30:00Z');
    const row = plan('2017-10-15 Night with Jason.md', modified);
    expect(row).toMatchObject({
      title: 'Night with Jason',
      checked_in_at: '2017-10-16T03:30:00.000Z',
      timezone: 'America/Chicago',
      tz_source: 'fallback',
      time_source: 'file_modified',
      local_date: '2017-10-15',
      selected_default: true,
    });
  });

  it('defaults to 8pm local when the modified time is another day', () => {
    const row = plan('2017-10-15 Night with Jason.md', Date.parse('2021-03-01T00:00:00Z'));
    expect(row.time_source).toBe('default_evening');
    expect(row.checked_in_at).toBe('2017-10-16T01:00:00.000Z'); // 20:00 CDT
  });

  it('defaults to 8pm local with no modified time, across DST', () => {
    // January: CST (UTC-6).
    expect(plan('2018-01-10.md', null).checked_in_at).toBe('2018-01-11T02:00:00.000Z');
  });

  it('takes the zone from check-in history when there is any', () => {
    const row = plan('2018-08-01 Tokyo.md', null, { anchors: TOKYO });
    expect(row).toMatchObject({ timezone: 'Asia/Tokyo', tz_source: 'history', checked_in_at: '2018-08-01T11:00:00.000Z' });
  });

  it('falls back before the first anchor', () => {
    const row = plan('2016-08-01 Before.md', null, { anchors: TOKYO });
    expect(row).toMatchObject({ timezone: 'America/Chicago', tz_source: 'fallback' });
  });

  it('trims separators around the title, and allows no title', () => {
    expect(plan('2017-10-15 - Night_.md', null).title).toBe('Night');
    expect(plan('2017-10-15.md', null).title).toBeNull();
  });

  it('uses the whole name and modified time for undated files', () => {
    const modified = Date.parse('2019-05-05T15:00:00Z');
    expect(plan('Grocery thoughts.txt', modified)).toMatchObject({
      title: 'Grocery thoughts', checked_in_at: '2019-05-05T15:00:00.000Z', time_source: 'file_modified', selected_default: true,
    });
  });

  it('unticks an undated file with no modified time', () => {
    expect(plan('Undated.md', null)).toMatchObject({ time_source: 'missing', selected_default: false });
  });

  it('normalizes the body and flags an empty file', () => {
    expect(plan('a.md', 1, { text: '\uFEFFline one\r\nline two\r\n\r\n' }).body).toBe('line one\nline two');
    expect(plan('2017-10-15.md', null, { text: '  \n' })).toMatchObject({ error: 'The file is empty', selected_default: false });
  });

  it('excerpts the first line without markdown markers', () => {
    expect(plan('a.md', 1, { text: '\n# Heading here\nbody' }).excerpt).toBe('Heading here');
  });
});

describe('markDuplicates', () => {
  it('flags stored date+title, stored content, and repeats within the batch', () => {
    const rows = [
      plan('2017-10-15 Night with Jason.md', null),
      { ...plan('2017-10-16 Other.md', null, { text: 'Same text' }), index: 1 },
      { ...plan('2017-10-17 Fresh.md', null, { text: 'Fresh text' }), index: 2 },
      { ...plan('2017-10-17 fresh.md', null, { text: 'Different' }), index: 3 },
    ];
    markDuplicates(rows, {
      dateTitles: new Set(['2017-10-15|night with jason']),
      bodyHashes: new Set([bodyHash('Same text')]),
    });
    expect(rows.map((r) => r.duplicate)).toEqual(['date_title', 'content', null, 'batch']);
    expect(rows.map((r) => r.selected_default)).toEqual([false, false, true, false]);
  });
});

describe('parseImportMeta / decodeText', () => {
  it('pairs meta with files and falls back to multer names', () => {
    expect(parseImportMeta(JSON.stringify([{ name: 'é.md', lastModified: 5 }]), 2, ['x', 'y.md'])).toEqual([
      { name: 'é.md', lastModified: 5 },
      { name: 'y.md', lastModified: null },
    ]);
    expect(parseImportMeta('not json', 1, ['z.md'])).toEqual([{ name: 'z.md', lastModified: null }]);
  });

  it('decodes UTF-8, else Latin-1', () => {
    expect(decodeText(new TextEncoder().encode('café'))).toBe('café');
    expect(decodeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
  });
});
