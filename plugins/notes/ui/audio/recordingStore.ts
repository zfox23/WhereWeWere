/**
 * Crash-safe local storage for audio recordings (IndexedDB).
 *
 * While recording, every MediaRecorder chunk (~1 s) is written here the moment
 * it arrives, so a crashed tab, a killed browser or a dead battery loses at
 * most the last second. A recording leaves this store only after the server
 * has confirmed it (size and SHA-256 verified); until then it can be
 * recovered, retried and uploaded again.
 *
 * Records are scoped to the signed-in user's id: one person's unsent audio is
 * never offered to another account on the same device.
 */

export const DB_NAME = 'wwp-note-audio';
const DB_VERSION = 1;
const RECORDINGS = 'recordings';
const CHUNKS = 'chunks';

/** A recording whose last chunk is older than this, and still 'recording', is orphaned (its tab is gone). */
export const ORPHAN_AFTER_MS = 15_000;

export type RecordingState =
  | 'recording' // chunks are arriving
  | 'stopped' // complete locally, waiting to upload
  | 'uploading' // a server upload session exists
  | 'uploaded'; // the server has it (chunks deleted); awaiting attachment

export interface RecordingMeta {
  id: string;
  userId: string;
  state: RecordingState;
  mime: string;
  filename: string;
  startedAt: number;
  updatedAt: number;
  durationMs: number;
  chunkCount: number;
  bytes: number;
  deviceLabel: string | null;
  /** Where it came from: captured live, or a file the user picked. */
  source: 'recorded' | 'file';
  /** Server-side audio id once an upload session exists. */
  serverId: string | null;
  sha256: string | null;
  /** Note to attach to once uploaded (set when the note was saved before the upload finished). */
  noteId: string | null;
  attempts: number;
  error: string | null;
}

// Chunks are stored as ArrayBuffers, not Blobs: Safari has a long history of
// Blob-in-IndexedDB bugs, and ~1 s of audio is only tens of KB.
interface ChunkRow {
  recordingId: string;
  seq: number;
  data: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECORDINGS)) {
        db.createObjectStore(RECORDINGS, { keyPath: 'id' }).createIndex('userId', 'userId');
      }
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ['recordingId', 'seq'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the recordings database'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDb().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

/** Test helper: drop the cached connection (after the database was deleted). */
export function resetRecordingStoreConnection(): void {
  dbPromise?.then((d) => d.close()).catch(() => {});
  dbPromise = null;
}

const changes = new EventTarget();

/** Called after every stored change, so panels and the upload queue can refresh. */
export function onRecordingsChanged(listener: () => void): () => void {
  changes.addEventListener('change', listener);
  return () => changes.removeEventListener('change', listener);
}

function done(tx: IDBTransaction, notify = true): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      if (notify && tx.mode === 'readwrite') changes.dispatchEvent(new Event('change'));
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error('Recording storage failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Recording storage was aborted'));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function newRecordingId(): string {
  return crypto.randomUUID();
}

export async function createRecording(
  init: Pick<RecordingMeta, 'userId' | 'mime' | 'filename' | 'deviceLabel' | 'source'> & { id?: string; state?: RecordingState },
): Promise<RecordingMeta> {
  const now = Date.now();
  const meta: RecordingMeta = {
    id: init.id ?? newRecordingId(),
    userId: init.userId,
    state: init.state ?? 'recording',
    mime: init.mime,
    filename: init.filename,
    startedAt: now,
    updatedAt: now,
    durationMs: 0,
    chunkCount: 0,
    bytes: 0,
    deviceLabel: init.deviceLabel,
    source: init.source,
    serverId: null,
    sha256: null,
    noteId: null,
    attempts: 0,
    error: null,
  };
  const d = await db();
  const tx = d.transaction(RECORDINGS, 'readwrite');
  tx.objectStore(RECORDINGS).put(meta);
  await done(tx);
  return meta;
}

/**
 * Persist one chunk and bump the recording's counters in a single
 * transaction, so metadata never claims a chunk that was not stored.
 */
export async function appendChunk(recordingId: string, seq: number, blob: Blob, durationMs: number): Promise<void> {
  // Read the bytes before the transaction opens: awaiting a non-IndexedDB
  // promise inside one would let it auto-commit early.
  const data = await blob.arrayBuffer();
  const d = await db();
  const tx = d.transaction([RECORDINGS, CHUNKS], 'readwrite');
  const recordings = tx.objectStore(RECORDINGS);
  const meta = (await request(recordings.get(recordingId))) as RecordingMeta | undefined;
  if (!meta) {
    tx.abort();
    throw new Error('Recording not found');
  }
  tx.objectStore(CHUNKS).put({ recordingId, seq, data } satisfies ChunkRow);
  recordings.put({
    ...meta,
    chunkCount: Math.max(meta.chunkCount, seq + 1),
    bytes: meta.bytes + data.byteLength,
    durationMs,
    updatedAt: Date.now(),
  });
  // A chunk lands every second while recording; that must not wake the upload queue.
  await done(tx, false);
}

export async function updateRecording(id: string, patch: Partial<RecordingMeta>): Promise<RecordingMeta | null> {
  const d = await db();
  const tx = d.transaction(RECORDINGS, 'readwrite');
  const store = tx.objectStore(RECORDINGS);
  const meta = (await request(store.get(id))) as RecordingMeta | undefined;
  if (!meta) {
    await done(tx);
    return null;
  }
  const next = { ...meta, ...patch, id: meta.id, userId: meta.userId, updatedAt: Date.now() };
  store.put(next);
  await done(tx);
  return next;
}

export async function getRecording(id: string): Promise<RecordingMeta | null> {
  const d = await db();
  return ((await request(d.transaction(RECORDINGS).objectStore(RECORDINGS).get(id))) as RecordingMeta | undefined) ?? null;
}

export async function listRecordings(userId: string): Promise<RecordingMeta[]> {
  const d = await db();
  const rows = (await request(d.transaction(RECORDINGS).objectStore(RECORDINGS).index('userId').getAll(userId))) as RecordingMeta[];
  return rows.sort((a, b) => a.startedAt - b.startedAt);
}

/** Has anything the user would lose if the browser data were wiped? */
export async function countUnsent(userId: string): Promise<number> {
  return (await listRecordings(userId)).filter((r) => r.state !== 'uploaded').length;
}

/** 'recording' records whose tab is gone: a crash, a closed tab or a dead battery left them. */
export function isOrphaned(meta: RecordingMeta, now = Date.now()): boolean {
  return meta.state === 'recording' && now - meta.updatedAt > ORPHAN_AFTER_MS;
}

/** The recording's audio, reassembled from its stored chunks in order. */
export async function assembleBlob(meta: RecordingMeta): Promise<Blob> {
  const d = await db();
  const range = IDBKeyRange.bound([meta.id, 0], [meta.id, Number.MAX_SAFE_INTEGER]);
  const rows = (await request(d.transaction(CHUNKS).objectStore(CHUNKS).getAll(range))) as ChunkRow[];
  return new Blob(rows.map((r) => r.data), { type: meta.mime });
}

/** Close out an interrupted recording: what was stored is the recording. */
export async function recoverRecording(id: string): Promise<RecordingMeta | null> {
  const meta = await getRecording(id);
  if (!meta) return null;
  if (meta.state !== 'recording') return meta;
  if (meta.chunkCount === 0) {
    await deleteRecording(id);
    return null;
  }
  // Duration isn't in the container of an interrupted recording; the
  // wall-clock span of the stored chunks is the best estimate.
  return updateRecording(id, { state: 'stopped', durationMs: Math.max(meta.durationMs, meta.updatedAt - meta.startedAt) });
}

/** Remove a recording and its chunks. Only call once the server confirmed it, or the user chose to discard. */
export async function deleteRecording(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction([RECORDINGS, CHUNKS], 'readwrite');
  tx.objectStore(RECORDINGS).delete(id);
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  await done(tx);
}

/** The server confirmed it: free the local audio but keep the small record until it is attached to a note. */
export async function markUploaded(id: string): Promise<RecordingMeta | null> {
  const d = await db();
  const tx = d.transaction([RECORDINGS, CHUNKS], 'readwrite');
  const store = tx.objectStore(RECORDINGS);
  const meta = (await request(store.get(id))) as RecordingMeta | undefined;
  if (!meta) {
    await done(tx);
    return null;
  }
  const next: RecordingMeta = { ...meta, state: 'uploaded', error: null, updatedAt: Date.now() };
  store.put(next);
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  await done(tx);
  return next;
}

/** Ask the browser not to evict this origin's storage under pressure. Best effort. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    // unsupported
  }
  return false;
}
