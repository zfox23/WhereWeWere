import { describe, expect, it } from 'vitest';
import { markAudioDuplicates, parseStamp, planAudioImportRow, type AudioFileMeta, type PlannedAudio } from '../services/importAudio';
import { parseFileMetas } from '../audioImportRoutes';
import { audioMimeForName, extensionOf } from '../audioTypes';

const FALLBACK = 'America/Chicago';
const meta = (name: string, over: Partial<AudioFileMeta> = {}): AudioFileMeta =>
  ({ name, size: 1000, lastModified: null, sha256: null, ...over });
const plan = (name: string, over: Partial<AudioFileMeta> = {}, anchors: { at: number; timezone: string }[] = []) =>
  planAudioImportRow({ index: 0, meta: meta(name, over), anchors, fallbackTimezone: FALLBACK, now: Date.UTC(2024, 5, 1) });

describe('parseStamp', () => {
  it('reads date, time and title text', () => {
    expect(parseStamp('2023-04-05 14.30.59 Walk in the park')).toMatchObject({ y: 2023, m: 4, d: 5, hh: 14, mm: 30, ss: 59, date: '2023-04-05', rest: ' Walk in the park' });
    expect(parseStamp('2023-04-05 14.30.59')?.rest).toBe('');
    expect(parseStamp('2023-04-05_14.30.59_x')?.hh).toBe(14);
  });

  it('rejects impossible dates and times, and runs of digits', () => {
    expect(parseStamp('2023-02-30 10.00.00 x')).toBeNull();
    expect(parseStamp('2023-04-05 24.00.00 x')).toBeNull();
    expect(parseStamp('2023-04-05 10.60.00 x')).toBeNull();
    expect(parseStamp('2023-04-05 10.00.60 x')).toBeNull();
    expect(parseStamp('2023-04-05 10.00.000 x')).toBeNull();
    expect(parseStamp('2023-04-05 Walk')).toBeNull();
    expect(parseStamp('2023-04-05-10.00.00 x')).toBeNull();
  });
});

describe('planAudioImportRow: YYYY-MM-DD HH.mm.SS <title>', () => {
  it('uses the time in the name, as local time in the fallback zone, whatever the file’s modified time', () => {
    const row = plan('2023-04-05 14.30.59 Walk in the park.m4a', { lastModified: Date.UTC(2020, 0, 1) });
    expect(row).toMatchObject({
      title: 'Walk in the park', time_source: 'filename', timezone: FALLBACK, tz_source: 'fallback',
      local_date: '2023-04-05', checked_in_at: '2023-04-05T19:30:59.000Z', // 14:30:59 CDT
      mime: 'audio/mp4', error: null, selected_default: true,
    });
  });

  it('takes the zone from check-in history, and reads the wall time in it', () => {
    const row = plan('2023-04-05 14.30.59 Walk.m4a', {}, [{ at: Date.UTC(2023, 0, 1), timezone: 'Europe/London' }]);
    expect(row).toMatchObject({ timezone: 'Europe/London', tz_source: 'history', checked_in_at: '2023-04-05T13:30:59.000Z' }); // BST
  });

  it('follows a trip: the zone in effect at that moment wins', () => {
    const anchors = [
      { at: Date.UTC(2023, 0, 1), timezone: 'America/New_York' },
      { at: Date.UTC(2023, 3, 1), timezone: 'Asia/Tokyo' },
    ];
    expect(plan('2023-03-20 09.00.00 a.mp3', {}, anchors).timezone).toBe('America/New_York');
    expect(plan('2023-04-05 09.00.00 b.mp3', {}, anchors)).toMatchObject({ timezone: 'Asia/Tokyo', checked_in_at: '2023-04-05T00:00:00.000Z' });
  });

  it('allows an untitled note, an underscore separator, and tidies the title', () => {
    expect(plan('2023-04-05 14.30.59.m4a').title).toBeNull();
    expect(plan('2023-04-05_14.30.59_Walk.m4a').title).toBe('Walk');
    expect(plan('2023-04-05 14.30.59 -  Walk   and   talk .wav').title).toBe('Walk and talk');
  });

  it('only reads a folder-less file name (the path never matters)', () => {
    expect(plan('Voice Memos/2023-04-05 14.30.59 Walk.m4a').title).toBe('Walk');
  });
});

describe('planAudioImportRow: the text import’s rules still apply to other names', () => {
  it('YYYY-MM-DD <title>: file modified time on the same local day, else 8pm', () => {
    const sameDay = plan('2023-04-05 Walk.m4a', { lastModified: Date.UTC(2023, 3, 5, 22, 0, 0) }); // 5pm CDT, Apr 5
    expect(sameDay).toMatchObject({ title: 'Walk', time_source: 'file_modified', checked_in_at: '2023-04-05T22:00:00.000Z' });
    const otherDay = plan('2023-04-05 Walk.m4a', { lastModified: Date.UTC(2024, 0, 1) });
    expect(otherDay).toMatchObject({ time_source: 'default_evening', checked_in_at: '2023-04-06T01:00:00.000Z' }); // 8pm CDT
    expect(plan('2023-04-05 Walk.m4a')).toMatchObject({ time_source: 'default_evening' });
  });

  it('no date in the name: the file’s modified time, else flagged and unticked', () => {
    expect(plan('Walk in the park.mp3', { lastModified: Date.UTC(2022, 5, 6, 12) })).toMatchObject({
      title: 'Walk in the park', time_source: 'file_modified', checked_in_at: '2022-06-06T12:00:00.000Z', selected_default: true,
    });
    const undated = plan('Walk.mp3');
    expect(undated).toMatchObject({ time_source: 'missing', checked_in_at: '2024-06-01T00:00:00.000Z', selected_default: false });
  });

  it('a stamp that is not a real time falls back to the date-only rules', () => {
    const row = plan('2023-04-05 25.30.59 x.m4a');
    expect(row.time_source).not.toBe('filename');
    expect(row.title).toBe('25.30.59 x');
  });
});

describe('planAudioImportRow: unusable files', () => {
  it('flags unsupported types, hidden files, empty and oversize files', () => {
    expect(plan('notes.txt').error).toBe('Not a supported audio file');
    expect(plan('movie.mp4').error).toBe('Not a supported audio file'); // video container: never ingested
    expect(plan('._2023-04-05 14.30.59 x.m4a').error).toBe('Not a supported audio file'); // macOS resource fork
    expect(plan('a.m4a', { size: 0 }).error).toBe('The file is empty');
    expect(plan('a.m4a', { size: 1024 ** 3 + 1 }).error).toBe('The file is larger than 1 GB');
    expect(plan('a.m4a', { size: 1024 ** 3 }).error).toBeNull();
    expect(plan('notes.txt').selected_default).toBe(false);
  });

  it('only keeps a well-formed checksum', () => {
    expect(plan('a.m4a', { sha256: 'A'.repeat(64) }).sha256).toBe('a'.repeat(64));
    expect(plan('a.m4a', { sha256: 'xyz' }).sha256).toBeNull();
  });
});

describe('markAudioDuplicates', () => {
  const rows = (...shas: (string | null)[]): PlannedAudio[] =>
    shas.map((s, i) => ({ ...plan(`f${i}.m4a`, { sha256: s, lastModified: Date.UTC(2023, 0, 1) }), index: i }));
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);

  it('flags audio already attached to a note, and repeats within the batch, and unticks them', () => {
    const marked = markAudioDuplicates(rows(A, B, B, A), new Set([A]));
    expect(marked.map((r) => r.duplicate)).toEqual(['checksum', null, 'batch', 'checksum']);
    expect(marked.map((r) => r.selected_default)).toEqual([false, true, false, false]);
  });

  it('cannot judge a file without a checksum, and ignores rows that already have an error', () => {
    const list = rows(null, null);
    list[1].error = 'x';
    expect(markAudioDuplicates(list, new Set([A])).map((r) => r.duplicate)).toEqual([null, null]);
  });
});

describe('audioTypes', () => {
  it('maps extensions and trusts a browser type only if supported', () => {
    expect(extensionOf('a.B.FLAC')).toBe('.flac');
    expect(extensionOf('noext')).toBe('');
    expect(audioMimeForName('x.opus')).toBe('audio/ogg');
    expect(audioMimeForName('x', 'audio/x-m4a')).toBe('audio/x-m4a');
    expect(audioMimeForName('x.mp3', 'video/mp4')).toBe('audio/mpeg');
    expect(audioMimeForName('x.mp4', 'video/mp4')).toBeNull();
    expect(audioMimeForName('.hidden.mp3')).toBeNull();
  });
});

describe('parseFileMetas', () => {
  it('validates the plan request', () => {
    expect(parseFileMetas([{ name: 'a.m4a', size: 5, last_modified: 100, sha256: 'x' }])).toEqual([{ name: 'a.m4a', size: 5, lastModified: 100, sha256: 'x' }]);
    expect(parseFileMetas([{ name: 'a.m4a', size: 'big' }])[0]).toMatchObject({ size: 0, lastModified: null, sha256: null });
    expect(() => parseFileMetas([])).toThrow();
    expect(() => parseFileMetas('no')).toThrow();
    expect(() => parseFileMetas([{ size: 1 }])).toThrow();
    expect(() => parseFileMetas(Array.from({ length: 5001 }, () => ({ name: 'a.m4a' })))).toThrow(/at most 5000/);
  });
});
