/**
 * Resumable upload of one stored recording.
 *
 * The server keeps a partial file per upload session and answers every chunk
 * with the byte offset it now holds, so a dropped connection, a reload or a
 * crash resumes where it stopped instead of starting over. The session id and
 * checksum are persisted locally the moment they exist. The whole file is
 * verified (size + SHA-256) by the server before it says it's done; only then
 * may the caller discard the local copy.
 */

import { audioApi, AudioApiError, type FetchLike } from './audioApi';
import { sha256Blob } from './sha256';
import { updateRecording, type RecordingMeta } from './recordingStore';

export const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_RESTARTS = 3;

export interface UploadDeps {
  fetchImpl?: FetchLike;
  chunkBytes?: number;
  onProgress?: (sent: number, total: number) => void;
}

/** Upload `blob` for `meta`; resolves with the server-side audio id once the server verified it. */
export async function uploadRecording(meta: RecordingMeta, blob: Blob, deps: UploadDeps = {}): Promise<string> {
  const f = deps.fetchImpl;
  const chunk = deps.chunkBytes ?? CHUNK_BYTES;
  if (blob.size === 0) throw new AudioApiError('The recording is empty', 400);

  let sha = meta.sha256;
  if (!sha) {
    sha = await sha256Blob(blob);
    await updateRecording(meta.id, { sha256: sha });
  }

  let serverId = meta.serverId;
  let restarts = 0;

  // A server session can vanish (e.g. its partial file was cleaned up): start a fresh one.
  const startSession = async () => {
    const started = await audioApi.start(
      { filename: meta.filename, mime: meta.mime, bytes: blob.size, sha256: sha!, duration_ms: meta.durationMs || null },
      f,
    );
    serverId = started.id;
    await updateRecording(meta.id, { serverId, state: 'uploading', error: null });
    return started.offset;
  };

  let offset: number;
  if (serverId) {
    try {
      const state = await audioApi.state(serverId, f);
      if (state.status !== 'uploading') return serverId; // already complete on the server
      offset = state.offset;
    } catch (err) {
      if (!(err instanceof AudioApiError) || err.status !== 404) throw err;
      offset = await startSession();
    }
  } else {
    offset = await startSession();
  }

  for (;;) {
    while (offset < blob.size) {
      const end = Math.min(offset + chunk, blob.size);
      try {
        const res = await audioApi.chunk(serverId!, offset, blob.slice(offset, end), f);
        offset = res.offset;
      } catch (err) {
        // The server's copy ends somewhere else than we thought: continue from there.
        if (err instanceof AudioApiError && err.status === 409 && typeof err.body.offset === 'number') {
          offset = err.body.offset;
          continue;
        }
        throw err;
      }
      deps.onProgress?.(offset, blob.size);
    }
    try {
      await audioApi.complete(serverId!, f);
      return serverId!;
    } catch (err) {
      if (err instanceof AudioApiError && (err.status === 409 || err.status === 422) && restarts < MAX_RESTARTS) {
        // 409: the server holds less than we sent; 422: what it holds is corrupt. Resume or resend.
        restarts += 1;
        offset = typeof err.body.offset === 'number' ? err.body.offset : 0;
        continue;
      }
      throw err;
    }
  }
}
