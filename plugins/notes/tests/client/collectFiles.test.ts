import { describe, expect, it } from 'vitest';
import {
  collectFromEntries, collectFromFileList, entriesFromDataTransfer, fileKey, type FsEntry,
} from '../../ui/audio/collectFiles';

const f = (name: string, type = '', size = 3, lastModified = 1000) => new File([new Uint8Array(size)], name, { type, lastModified });
const fileEntry = (file: File): FsEntry => ({ isFile: true, isDirectory: false, name: file.name, file: (ok) => ok(file) });
/** A directory whose readEntries hands out `pageSize` entries per call, like Chrome (which caps at 100). */
const dirEntry = (name: string, children: FsEntry[], pageSize = 2): FsEntry => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let i = 0;
    return { readEntries: (ok) => { const page = children.slice(i, i + pageSize); i += pageSize; ok(page); } };
  },
});

describe('collectFromEntries', () => {
  it('walks folders recursively, keeps supported audio only, and counts the rest', async () => {
    const tree = dirEntry('Voice Memos', [
      fileEntry(f('2023-04-05 14.30.59 Walk.m4a', 'audio/mp4')),
      fileEntry(f('notes.txt', 'text/plain')),
      fileEntry(f('.DS_Store')),
      fileEntry(f('._2023-04-05 14.30.59 Walk.m4a')),
      fileEntry(f('cover.jpg', 'image/jpeg')),
      dirEntry('2022', [fileEntry(f('a.mp3', 'audio/mpeg')), fileEntry(f('b.FLAC')), fileEntry(f('movie.mp4', 'video/mp4'))]),
      dirEntry('.Trash', [fileEntry(f('deleted.m4a'))]),
    ]);
    const out = await collectFromEntries([tree]);
    expect(out.files.map((c) => c.path)).toEqual([
      'Voice Memos/2023-04-05 14.30.59 Walk.m4a',
      'Voice Memos/2022/a.mp3',
      'Voice Memos/2022/b.FLAC',
    ]);
    expect(out.ignored).toBe(5); // txt, .DS_Store, ._ fork, jpg, mp4 (the hidden folder is skipped whole, not counted)
  });

  it('reads every page of a large folder, not just the first', async () => {
    const many = Array.from({ length: 7 }, (_, i) => fileEntry(f(`m${i}.mp3`, 'audio/mpeg')));
    const out = await collectFromEntries([dirEntry('big', many, 3)]);
    expect(out.files).toHaveLength(7);
  });

  it('mixes folders with loose files', async () => {
    const out = await collectFromEntries([dirEntry('d', [fileEntry(f('a.wav'))])], [f('b.ogg'), f('c.doc')]);
    expect(out.files.map((c) => c.path)).toEqual(['d/a.wav', 'b.ogg']);
    expect(out.ignored).toBe(1);
  });
});

describe('entriesFromDataTransfer', () => {
  it('takes entries from items (folders included) and loose files when an item has no entry', () => {
    const entry = dirEntry('d', []);
    const plain = f('x.mp3');
    const dt = {
      items: [
        { kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => null },
        { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => plain },
        { kind: 'string', webkitGetAsEntry: () => null, getAsFile: () => null },
      ],
      files: [],
    } as unknown as DataTransfer;
    expect(entriesFromDataTransfer(dt)).toEqual({ entries: [entry], loose: [plain] });
  });

  it('falls back to dataTransfer.files when items are unavailable', () => {
    const a = f('a.mp3');
    expect(entriesFromDataTransfer({ items: [], files: [a] } as unknown as DataTransfer).loose).toEqual([a]);
  });
});

describe('collectFromFileList', () => {
  it('uses the relative path from a folder picker and skips hidden and unsupported files', () => {
    const withPath = (file: File, rel: string) => Object.defineProperty(file, 'webkitRelativePath', { value: rel });
    const out = collectFromFileList([
      withPath(f('a.m4a', 'audio/mp4'), 'Memos/a.m4a'),
      withPath(f('b.m4a', 'audio/mp4'), 'Memos/.hidden/b.m4a'),
      withPath(f('c.txt', 'text/plain'), 'Memos/c.txt'),
      f('d.mp3', 'audio/mpeg'),
    ]);
    expect(out.files.map((c) => c.path)).toEqual(['Memos/a.m4a', 'd.mp3']);
    expect(out.ignored).toBe(2);
  });
});

describe('fileKey', () => {
  it('is the same for the same file dropped twice, different otherwise', () => {
    const a = { file: f('a.mp3', '', 5, 10), path: 'a.mp3' };
    expect(fileKey(a)).toBe(fileKey({ file: f('a.mp3', '', 5, 10), path: 'a.mp3' }));
    expect(fileKey(a)).not.toBe(fileKey({ file: f('a.mp3', '', 6, 10), path: 'a.mp3' }));
    expect(fileKey(a)).not.toBe(fileKey({ file: f('a.mp3', '', 5, 10), path: 'x/a.mp3' }));
  });
});
