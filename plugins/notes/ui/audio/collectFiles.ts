/**
 * Gathering audio files from what the user drops or picks: loose files, whole
 * folders (walked recursively), or a mix. Only supported audio types are kept;
 * everything else, including hidden files, is counted and ignored.
 *
 * Note for callers: a drop event's directory entries are only valid until the
 * event handler returns, so `entriesFromDataTransfer` must be called
 * synchronously inside it; the (async) walk can then run afterwards.
 */

import { audioMimeForName } from '../../audioTypes';

export interface CollectedFile {
  file: File;
  /** Where it was found, e.g. "Voice Memos/2023/2023-04-05 14.30.59 Walk.m4a" (just the name for a loose file). */
  path: string;
}

export interface Collected {
  files: CollectedFile[];
  /** Files seen but not kept: unsupported types and hidden files. */
  ignored: number;
}

/** The slice of the File System Access entry API the walk needs (structural, so tests can fake it). */
export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (file: File) => void, fail: (err: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: FsEntry[]) => void, fail: (err: unknown) => void) => void };
}

function readAll(reader: ReturnType<NonNullable<FsEntry['createReader']>>): Promise<FsEntry[]> {
  // readEntries returns at most ~100 entries per call; keep asking until it returns none.
  return new Promise((resolve, reject) => {
    const all: FsEntry[] = [];
    const next = () => reader.readEntries((batch) => {
      if (batch.length === 0) resolve(all);
      else {
        all.push(...batch);
        next();
      }
    }, reject);
    next();
  });
}

async function walk(entry: FsEntry, prefix: string, out: Collected): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isDirectory && entry.createReader) {
    // Hidden folders (.Trash, .git, ...) are not worth descending into.
    if (entry.name.startsWith('.')) return;
    for (const child of await readAll(entry.createReader())) await walk(child, path, out);
    return;
  }
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    if (audioMimeForName(file.name, file.type)) out.files.push({ file, path });
    else out.ignored += 1;
  }
}

/** Read the entries out of a drop event. Call synchronously from the handler. */
export function entriesFromDataTransfer(dt: DataTransfer): { entries: FsEntry[]; loose: File[] } {
  const entries: FsEntry[] = [];
  const loose: File[] = [];
  const items = Array.from(dt.items ?? []);
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
      if (entry) entries.push(entry);
      else {
        const f = item.getAsFile();
        if (f) loose.push(f);
      }
    }
  } else {
    loose.push(...Array.from(dt.files ?? []));
  }
  return { entries, loose };
}

/** Walk dropped entries (folders recursively) and keep the supported audio files. */
export async function collectFromEntries(entries: FsEntry[], loose: File[] = []): Promise<Collected> {
  const out: Collected = { files: [], ignored: 0 };
  for (const entry of entries) await walk(entry, '', out);
  for (const file of loose) {
    if (audioMimeForName(file.name, file.type)) out.files.push({ file, path: file.name });
    else out.ignored += 1;
  }
  return out;
}

/** Files from an `<input type="file">` (including `webkitdirectory`, which sets webkitRelativePath). */
export function collectFromFileList(list: FileList | File[]): Collected {
  const out: Collected = { files: [], ignored: 0 };
  for (const file of Array.from(list)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const hidden = rel.split('/').some((part) => part.startsWith('.'));
    if (!hidden && audioMimeForName(file.name, file.type)) out.files.push({ file, path: rel });
    else out.ignored += 1;
  }
  return out;
}

/** Identity of a staged file, so dropping the same file twice doesn't stage it twice. */
export function fileKey(c: CollectedFile): string {
  return `${c.path}|${c.file.size}|${c.file.lastModified}`;
}
