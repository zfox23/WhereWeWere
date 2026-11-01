/**
 * Client for the notes audio endpoints (see plugins/notes/audioRoutes.ts).
 * Thin on purpose: the uploader owns the retry/resume logic. Failures are
 * reported as `AudioApiError` carrying the status and the server's body, which
 * matters for resuming (a 409 says where the server's copy ends).
 */

import { apiFetch } from '../../../../client/src/api/client';

const BASE = '/api/v1/notes';

export class AudioApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AudioApiError';
  }
  /** Network trouble or a server hiccup: worth trying again later. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500 || this.status === 401 || this.status === 403;
  }
}

export type FetchLike = typeof apiFetch;

async function call(fetchImpl: FetchLike, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}${path}`, { credentials: 'same-origin', ...init });
  } catch (err) {
    throw new AudioApiError(err instanceof Error ? err.message : 'Network error', 0);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new AudioApiError(typeof body.error === 'string' ? body.error : `Request failed: ${res.status}`, res.status, body);
  return body;
}

const json = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export interface UploadInit {
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
  duration_ms?: number | null;
}

export const audioApi = {
  start: async (data: UploadInit, f: FetchLike = apiFetch) => (await call(f, '/audio/uploads', json(data))) as { id: string; offset: number },
  state: async (id: string, f: FetchLike = apiFetch) =>
    (await call(f, `/audio/uploads/${id}`)) as { id: string; offset: number; bytes: number; status: string },
  chunk: async (id: string, offset: number, data: Blob, f: FetchLike = apiFetch) =>
    (await call(f, `/audio/uploads/${id}?offset=${offset}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    })) as { offset: number },
  complete: async (id: string, f: FetchLike = apiFetch) =>
    (await call(f, `/audio/uploads/${id}/complete`, { method: 'POST' })) as { id: string; status: string },
  attach: async (id: string, noteId: string, f: FetchLike = apiFetch) =>
    (await call(f, `/audio/${id}/attach`, { ...json({ note_id: noteId }), method: 'PUT' })) as Record<string, unknown>,
};
