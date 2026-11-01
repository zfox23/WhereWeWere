/**
 * Audio attachments for notes — upload, attach, list, play back, delete.
 * Mounted on the notes router (/api/v1/notes).
 *
 *   POST   /audio/uploads                 start an upload session -> { id, offset: 0 }
 *   GET    /audio/uploads/:id             how many bytes the server has -> { offset, bytes }
 *   PUT    /audio/uploads/:id?offset=N    append one raw chunk (409 + { offset } on mismatch)
 *   POST   /audio/uploads/:id/complete    verify size + SHA-256, store the original, queue transcription
 *   GET    /audio/:id                     stream the original (HTTP Range supported)
 *   PUT    /audio/:id/attach              attach to a note { note_id, position? }
 *   DELETE /audio/:id                     remove the row, its segments and the file
 *   GET    /checkins/:id/audio            a note's audio files (with transcripts' status)
 *
 * Uploads are resumable on purpose: a recording that is hundreds of MB must
 * survive a dropped connection without restarting. Every handler captures the
 * signed-in user up front because stream callbacks lose the request context.
 */

import fs from 'fs';
import path from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { Request, Response, Router } from 'express';
import { query } from '../../server/src/db';
import { isUuid } from '../../server/src/services/batching';
import { currentUserId } from '../../server/src/auth/context';
import {
  MAX_AUDIO_BYTES,
  audioExtForMime,
  deleteNoteAudioFile,
  noteAudioDir,
  noteAudioPath,
  storeNoteAudio,
} from './services/audioFiles';

/** Largest single chunk the server accepts; clients send ~8 MB. */
export const MAX_CHUNK_BYTES = 32 * 1024 * 1024;
const SHA256_RE = /^[0-9a-f]{64}$/i;

const AUDIO_COLUMNS = `id, note_id, filename, mime, bytes, sha256, duration_ms, position, status,
  error, language, model, created_at`;

function partialPath(userId: string, id: string): string {
  return path.join(noteAudioDir(userId), '.partial', `${id}.part`);
}

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

function fail(res: Response, err: unknown, fallback: string) {
  console.error(`${fallback}:`, err);
  return res.status(500).json({ error: fallback });
}

export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

export function registerAudioRoutes(router: Router): void {
  router.post('/audio/uploads', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const { filename, mime, bytes, sha256, duration_ms } = req.body ?? {};
      const ext = typeof mime === 'string' ? audioExtForMime(mime) : null;
      if (!ext) return res.status(400).json({ error: 'Unsupported audio type' });
      if (!Number.isInteger(bytes) || bytes <= 0) return res.status(400).json({ error: 'bytes must be a positive integer' });
      if (bytes > MAX_AUDIO_BYTES) return res.status(413).json({ error: 'Audio file is too large (limit 1 GB)' });
      if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) return res.status(400).json({ error: 'sha256 must be a hex digest' });
      const duration = Number.isInteger(duration_ms) && duration_ms >= 0 ? duration_ms : null;
      const name = typeof filename === 'string' && filename.trim() ? filename.trim().slice(0, 255) : `recording${ext}`;
      const baseMime = (mime as string).split(';')[0].trim().toLowerCase();
      const result = await query(
        `INSERT INTO note_audio (user_id, filename, mime, bytes, sha256, duration_ms, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'uploading') RETURNING id`,
        [userId, name, baseMime, bytes, sha256.toLowerCase(), duration],
      );
      const id = result.rows[0].id as string;
      fs.mkdirSync(path.dirname(partialPath(userId, id)), { recursive: true });
      fs.writeFileSync(partialPath(userId, id), '');
      res.status(201).json({ id, offset: 0 });
    } catch (err) {
      fail(res, err, 'Failed to start audio upload');
    }
  });

  async function ownUpload(userId: string, id: string) {
    if (!isUuid(id)) return null;
    const r = await query(
      `SELECT id, bytes, sha256, mime, status FROM note_audio WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return r.rows[0] ?? null;
  }

  router.get('/audio/uploads/:id', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const row = await ownUpload(userId, String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Upload not found' });
      const offset = row.status === 'uploading' ? fileSize(partialPath(userId, row.id)) : Number(row.bytes);
      res.json({ id: row.id, offset, bytes: Number(row.bytes), status: row.status });
    } catch (err) {
      fail(res, err, 'Failed to read upload state');
    }
  });

  router.put('/audio/uploads/:id', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const row = await ownUpload(userId, String(req.params.id));
      if (!row || row.status !== 'uploading') return res.status(404).json({ error: 'Upload not found' });
      const file = partialPath(userId, row.id);
      const current = fileSize(file);
      const offset = Number(req.query.offset);
      if (!Number.isInteger(offset) || offset !== current) {
        return res.status(409).json({ error: 'Offset mismatch', offset: current });
      }
      let received = 0;
      const cap = new Transform({
        transform(chunk, _enc, cb) {
          received += chunk.length;
          if (received > MAX_CHUNK_BYTES || current + received > Number(row.bytes)) {
            cb(new Error('chunk too large'));
          } else {
            cb(null, chunk);
          }
        },
      });
      try {
        await pipeline(req, cap, fs.createWriteStream(file, { flags: 'a' }));
      } catch (err) {
        // Roll the partial file back to the last acknowledged size so a
        // half-written chunk can never corrupt the recording.
        fs.truncateSync(file, current);
        if ((err as Error).message === 'chunk too large') {
          return res.status(413).json({ error: 'Chunk too large', offset: current });
        }
        throw err;
      }
      res.json({ offset: current + received });
    } catch (err) {
      fail(res, err, 'Failed to write audio chunk');
    }
  });

  router.post('/audio/uploads/:id/complete', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const row = await ownUpload(userId, String(req.params.id));
      if (!row) return res.status(404).json({ error: 'Upload not found' });
      if (row.status !== 'uploading') return res.json({ id: row.id, status: row.status }); // idempotent
      const part = partialPath(userId, row.id);
      const size = fileSize(part);
      if (size !== Number(row.bytes)) {
        return res.status(409).json({ error: 'Upload incomplete', offset: size });
      }
      const ext = audioExtForMime(row.mime) as string;
      try {
        await storeNoteAudio(userId, part, row.id, ext, row.sha256);
      } catch (err) {
        // The bytes are wrong: drop them so the client re-sends from zero.
        fs.writeFileSync(part, '');
        return res.status(422).json({ error: (err as Error).message, offset: 0 });
      }
      await query(`UPDATE note_audio SET status = 'pending', next_attempt_at = NOW() WHERE id = $1`, [row.id]);
      res.json({ id: row.id, status: 'pending' });
    } catch (err) {
      fail(res, err, 'Failed to finish audio upload');
    }
  });

  router.get('/audio/:id', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(404).json({ error: 'Audio not found' });
      const r = await query(
        `SELECT id, mime FROM note_audio WHERE id = $1 AND user_id = $2 AND status <> 'uploading'`,
        [id, userId],
      );
      const row = r.rows[0];
      const file = row ? noteAudioPath(userId, id, audioExtForMime(row.mime) as string) : null;
      if (!row || !file || !fs.existsSync(file)) return res.status(404).json({ error: 'Audio not found' });
      const size = fs.statSync(file).size;
      res.setHeader('Content-Type', row.mime);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'private, no-store');
      const range = parseRange(req.headers.range, size);
      if (range === 'invalid') {
        res.setHeader('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }
      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        res.setHeader('Content-Length', String(range.end - range.start + 1));
        return fs.createReadStream(file, { start: range.start, end: range.end }).pipe(res);
      }
      res.setHeader('Content-Length', String(size));
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      fail(res, err, 'Failed to read audio');
    }
  });

  router.put('/audio/:id/attach', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const id = String(req.params.id);
      const noteId = req.body?.note_id;
      if (!isUuid(id) || typeof noteId !== 'string' || !isUuid(noteId)) {
        return res.status(400).json({ error: 'Valid audio id and note_id required' });
      }
      const position = Number.isInteger(req.body?.position) ? req.body.position : null;
      const r = await query(
        `UPDATE note_audio SET note_id = $3,
                position = COALESCE($4, (SELECT COALESCE(MAX(position) + 1, 0) FROM note_audio WHERE note_id = $3))
         WHERE id = $1 AND user_id = $2
           AND EXISTS (SELECT 1 FROM note_checkins WHERE id = $3 AND user_id = $2)
         RETURNING ${AUDIO_COLUMNS}`,
        [id, userId, noteId, position],
      );
      if (r.rowCount === 0) return res.status(404).json({ error: 'Audio or note not found' });
      res.json(r.rows[0]);
    } catch (err) {
      fail(res, err, 'Failed to attach audio');
    }
  });

  router.delete('/audio/:id', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(404).json({ error: 'Audio not found' });
      const r = await query(
        `DELETE FROM note_audio WHERE id = $1 AND user_id = $2 RETURNING mime`,
        [id, userId],
      );
      if (r.rowCount === 0) return res.status(404).json({ error: 'Audio not found' });
      const ext = audioExtForMime(r.rows[0].mime);
      if (ext) deleteNoteAudioFile(noteAudioPath(userId, id, ext));
      deleteNoteAudioFile(partialPath(userId, id));
      res.json({ message: 'Audio deleted', id });
    } catch (err) {
      fail(res, err, 'Failed to delete audio');
    }
  });

  router.get('/checkins/:id/audio', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(404).json({ error: 'Note not found' });
      const r = await query(
        `SELECT ${AUDIO_COLUMNS} FROM note_audio
         WHERE note_id = $1 AND user_id = $2 AND status <> 'uploading' ORDER BY position, created_at`,
        [id, userId],
      );
      res.json(r.rows);
    } catch (err) {
      fail(res, err, 'Failed to list audio');
    }
  });
}
