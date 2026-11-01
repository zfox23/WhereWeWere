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

/** What to upload and how to report a server session id / checksum once they exist. */
export interface BlobUpload {
  filename: string;
  mime: string;
  durationMs: number | null;
  blob: Blob;
  /** Known checksum, if the caller already computed it. */
  sha256: string | null;
  /** An upload session to resume, if one exists. */
  serverId: string | null;
  /** Called once the checksum is known (so a caller can persist it). */
  onSha?: (sha256: string) => void | Promise<void>;
  /** Called whenever a server session starts (so a caller can persist it and resume later). */
  onSession?: (serverId: string) => void | Promise<void>;
  /** Import runs: hold from transcription / reuse a finished identical upload. */
  defer?: boolean;
  reuse?: boolean;
}

/** Upload `blob` in resumable chunks; resolves with the server-side audio id once the server verified it. */
export async function uploadBlob(upload: BlobUpload, deps: UploadDeps = {}): Promise<string> {
  const f = deps.fetchImpl;
  const chunk = deps.chunkBytes ?? CHUNK_BYTES;
  const { blob } = upload;
  if (blob.size === 0) throw new AudioApiError('The recording is empty', 400);

  let sha = upload.sha256;
  if (!sha) {
    sha = await sha256Blob(blob);
    await upload.onSha?.(sha);
  }

  let serverId = upload.serverId;
  let restarts = 0;
  let finished = false;

  // A server session can vanish (e.g. its partial file was cleaned up): start a fresh one.
  const startSession = async () => {
    const started = await audioApi.start(
      {
        filename: upload.filename, mime: upload.mime, bytes: blob.size, sha256: sha!, duration_ms: upload.durationMs,
        ...(upload.defer ? { defer: true } : {}), ...(upload.reuse ? { reuse: true } : {}),
      },
      f,
    );
    serverId = started.id;
    await upload.onSession?.(serverId);
    finished = started.complete === true; // an identical upload already finished earlier
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
  if (finished) return serverId!;

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

/** Upload one stored recording, persisting its checksum and session id so it can resume after a crash. */
export function uploadRecording(meta: RecordingMeta, blob: Blob, deps: UploadDeps = {}): Promise<string> {
  return uploadBlob(
    {
      filename: meta.filename,
      mime: meta.mime,
      durationMs: meta.durationMs || null,
      blob,
      sha256: meta.sha256,
      serverId: meta.serverId,
      onSha: async (sha256) => {
        await updateRecording(meta.id, { sha256 });
      },
      onSession: async (serverId) => {
        await updateRecording(meta.id, { serverId, state: 'uploading', error: null });
      },
    },
    deps,
  );
}
