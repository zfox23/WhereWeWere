/**
 * Background queue that gets every locally stored recording to the server.
 *
 * Runs at app start, when the browser comes back online, after a recording
 * stops, and on a backoff timer while uploads keep failing. Recordings stay in
 * IndexedDB (and visible as "unsent") until the server has verified them.
 * A recording whose note was saved before the upload finished is attached to
 * that note as soon as it lands.
 */

import { audioApi, AudioApiError, type FetchLike } from './audioApi';
import {
  assembleBlob, deleteRecording, listRecordings, markUploaded, onRecordingsChanged, updateRecording, type RecordingMeta,
} from './recordingStore';
import { uploadRecording, type UploadDeps } from './uploader';

const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 10 * 60_000;

export interface QueueResult {
  uploaded: number;
  failed: number;
}

export interface QueueDeps extends Pick<UploadDeps, 'chunkBytes' | 'onProgress'> {
  fetchImpl?: FetchLike;
}

let running: Promise<QueueResult> | null = null;

/** True while a pass over the queue is in progress. */
export function isUploading(): boolean {
  return running !== null;
}

/** Attach an uploaded recording to its note; true when nothing is left to do for it. */
async function attachIfNeeded(meta: RecordingMeta, f?: FetchLike): Promise<boolean> {
  if (!meta.serverId) return false;
  if (!meta.noteId) return true; // nothing to attach yet; the form does it on save
  try {
    await audioApi.attach(meta.serverId, meta.noteId, f);
    await deleteRecording(meta.id);
    return true;
  } catch (err) {
    if (err instanceof AudioApiError && err.status === 404) {
      // The note was deleted meanwhile: the audio is safe on the server, unattached.
      await updateRecording(meta.id, { noteId: null, error: 'The note this was recorded for no longer exists' });
      return true;
    }
    throw err;
  }
}

async function processOne(meta: RecordingMeta, deps: QueueDeps): Promise<void> {
  if (meta.state === 'uploaded') {
    await attachIfNeeded(meta, deps.fetchImpl);
    return;
  }
  const blob = await assembleBlob(meta);
  if (blob.size === 0 || (meta.bytes > 0 && blob.size !== meta.bytes)) {
    throw new AudioApiError('The stored recording is incomplete', 0);
  }
  await uploadRecording(meta, blob, deps);
  // The server verified size + checksum: now (and only now) free the local copy.
  const uploaded = await markUploaded(meta.id);
  if (uploaded) await attachIfNeeded(uploaded, deps.fetchImpl);
}

/** Try every unsent recording of this user once. Concurrent calls share one run. */
export function processUploads(userId: string, deps: QueueDeps = {}): Promise<QueueResult> {
  if (running) return running;
  running = (async () => {
    const result: QueueResult = { uploaded: 0, failed: 0 };
    const work = async () => {
      for (const meta of await listRecordings(userId)) {
        if (meta.state === 'recording') continue; // still being captured (or awaiting recovery)
        try {
          await processOne(meta, deps);
          if (meta.state !== 'uploaded') result.uploaded += 1;
        } catch (err) {
          result.failed += 1;
          const retryable = !(err instanceof AudioApiError) || err.retryable;
          await updateRecording(meta.id, {
            attempts: meta.attempts + 1,
            error: err instanceof Error ? err.message : 'Upload failed',
            // A server rejection (bad type, too large) won't fix itself; keep the audio and say why.
            ...(retryable ? {} : { attempts: Math.max(meta.attempts + 1, 99) }),
          }).catch(() => {});
        }
      }
    };
    // One uploader across tabs when the browser supports Web Locks.
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      await navigator.locks.request('wwp-note-audio-upload', { ifAvailable: true }, async (lock) => {
        if (lock) await work();
      });
    } else {
      await work();
    }
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Keep the queue running for the signed-in user. Returns a stop function. */
export function startUploadQueue(userId: string, deps: QueueDeps = {}): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = BASE_RETRY_MS;

  const schedule = (ms: number) => {
    if (timer) clearTimeout(timer);
    if (!stopped) timer = setTimeout(run, ms);
  };
  const run = async () => {
    if (stopped) return;
    try {
      const result = await processUploads(userId, deps);
      delay = result.failed > 0 ? Math.min(delay * 2, MAX_RETRY_MS) : BASE_RETRY_MS;
      if (result.failed > 0) schedule(delay);
    } catch {
      schedule(delay);
    }
  };
  const kick = () => {
    delay = BASE_RETRY_MS;
    void run();
  };

  const offChange = onRecordingsChanged(() => {
    // A recording just finished or was added. Changes the queue itself makes
    // while running (progress, error notes) must not re-trigger it, or a
    // failing upload would retry in a hot loop instead of on the backoff.
    if (!isUploading()) void run();
  });
  window.addEventListener('online', kick);
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    offChange();
    window.removeEventListener('online', kick);
  };
}
