/**
 * Audio attachments for notes — upload, attach, list, play back, delete.
 * Mounted on the notes router (/api/v1/notes).
 *
 *   POST   /audio/uploads                 start an upload session -> { id, offset: 0 }
 *                                         (import runs may pass defer: hold transcription, reuse: skip a finished duplicate upload)
 *   GET    /audio/uploads/:id             how many bytes the server has -> { offset, bytes }
 *   PUT    /audio/uploads/:id?offset=N    append one raw chunk (409 + { offset } on mismatch)
 *   POST   /audio/uploads/:id/complete    verify size + SHA-256, store the original, queue transcription
 *   GET    /audio/:id                     stream the original (HTTP Range supported)
 *   PUT    /audio/:id/attach              attach to a note { note_id, position? }
 *   DELETE /audio/:id                     remove the row, its segments and the file
 *   POST   /audio/:id/retranscribe        queue a fresh transcription (also retries a failed one)
 *   POST   /transcription/test            check the transcription endpoint { api_url?, model?, api_key? }
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
import { pool, query } from '../../server/src/db';
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
import { getTranscriptionConfig, kickTranscription, requeueAudio, testTranscriptionConfig } from './services/transcription';

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
      const digest = sha256.toLowerCase();
      // An import run that was interrupted leaves finished, unattached uploads behind: hand
      // one back instead of uploading the same bytes again.
      if (req.body?.reuse === true) {
        const existing = await query(
          `SELECT id FROM note_audio
            WHERE user_id = $1 AND sha256 = $2 AND bytes = $3 AND note_id IS NULL
              AND status IN ('pending', 'done', 'failed')
            ORDER BY created_at LIMIT 1`,
          [userId, digest, bytes],
        );
        if ((existing.rowCount ?? 0) > 0) return res.json({ id: existing.rows[0].id, offset: bytes, complete: true });
      }
      const name = typeof filename === 'string' && filename.trim() ? filename.trim().slice(0, 255) : `recording${ext}`;
      const baseMime = (mime as string).split(';')[0].trim().toLowerCase();
      const result = await query(
        // `defer`: an import run holds its files (next_attempt_at = infinity) until the whole run is done.
        `INSERT INTO note_audio (user_id, filename, mime, bytes, sha256, duration_ms, status, next_attempt_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'uploading', CASE WHEN $7::boolean THEN 'infinity'::timestamptz ELSE NOW() END)
         RETURNING id`,
        [userId, name, baseMime, bytes, digest, duration, req.body?.defer === true],
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
      await query(
        `UPDATE note_audio SET status = 'pending',
                next_attempt_at = CASE WHEN next_attempt_at = 'infinity' THEN next_attempt_at ELSE NOW() END
          WHERE id = $1`,
        [row.id],
      );
      kickTranscription();
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
      // Removing the only content of an otherwise empty note would leave a blank note.
      const sole = await query(
        `SELECT 1 FROM note_audio a JOIN note_checkins n ON n.id = a.note_id
          WHERE a.id = $1 AND a.user_id = $2
            AND COALESCE(btrim(n.title), '') = '' AND n.body !~ '\\S'
            AND NOT EXISTS (SELECT 1 FROM note_audio o WHERE o.note_id = n.id AND o.id <> a.id)`,
        [id, userId],
      );
      if ((sole.rowCount ?? 0) > 0) {
        return res.status(409).json({ error: 'This is the only content of the note; delete the note instead' });
      }
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

  router.put('/audio/:id/transcript', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(404).json({ error: 'Audio not found' });
      const incoming = req.body?.segments;
      if (!Array.isArray(incoming) || incoming.length === 0 || incoming.length > 20_000) {
        return res.status(400).json({ error: 'segments must be a non-empty array' });
      }
      const idx: number[] = [];
      const text: string[] = [];
      for (const s of incoming) {
        if (!Number.isInteger(s?.idx) || s.idx < 0 || typeof s?.text !== 'string' || s.text.length > 20_000) {
          return res.status(400).json({ error: 'Each segment needs an idx and text' });
        }
        idx.push(s.idx);
        text.push(s.text.trim());
      }
      const owned = await query(`SELECT 1 FROM note_audio WHERE id = $1 AND user_id = $2 AND status = 'done'`, [id, userId]);
      if (owned.rowCount === 0) return res.status(404).json({ error: 'Audio not found or not transcribed yet' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE note_audio_segments s SET text = t.txt, edited = TRUE
             FROM unnest($2::int[], $3::text[]) AS t(idx, txt)
            WHERE s.audio_id = $1 AND s.idx = t.idx AND s.text IS DISTINCT FROM t.txt`,
          [id, idx, text],
        );
        // Search and analysis read the joined text, so keep it in step with the segments.
        await client.query(
          `UPDATE note_audio SET transcript_text = COALESCE(
             (SELECT string_agg(text, ' ' ORDER BY idx) FROM note_audio_segments WHERE audio_id = $1 AND text <> ''), '')
           WHERE id = $1`,
          [id],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      const segments = await query(
        `SELECT idx, start_ms, end_ms, text, edited FROM note_audio_segments WHERE audio_id = $1 ORDER BY idx`,
        [id],
      );
      res.json({ segments: segments.rows });
    } catch (err) {
      fail(res, err, 'Failed to save the transcript');
    }
  });

  router.post('/audio/:id/retranscribe', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(404).json({ error: 'Audio not found' });
      if (!(await requeueAudio(id, userId))) return res.status(404).json({ error: 'Audio not found or still processing' });
      res.json({ id, status: 'pending' });
    } catch (err) {
      fail(res, err, 'Failed to queue transcription');
    }
  });

  router.post('/transcription/test', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const saved = await getTranscriptionConfig(userId);
      const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : '');
      const apiUrl = str(req.body?.api_url) || saved?.apiUrl || '';
      const model = str(req.body?.model) || saved?.model || '';
      if (!apiUrl) return res.status(400).json({ ok: false, message: 'Enter the transcription API URL first.' });
      // A blank key field means "use the saved one", mirroring the settings form.
      const apiKey = str(req.body?.api_key) || saved?.apiKey || null;
      res.json(await testTranscriptionConfig({ apiUrl, model, apiKey }));
    } catch (err) {
      fail(res, err, 'Failed to test the transcription service');
    }
  });

  router.get('/checkins/:id/audio', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const id = String(req.params.id);
      if (!isUuid(id)) return res.status(404).json({ error: 'Note not found' });
      const withSegments = req.query.include === 'segments';
      const r = await query(
        `SELECT ${AUDIO_COLUMNS.split(',').map((c) => `a.${c.trim()}`).join(', ')}
                ${withSegments ? `, COALESCE((SELECT json_agg(json_build_object('idx', s.idx, 'start_ms', s.start_ms,
                                                       'end_ms', s.end_ms, 'text', s.text, 'edited', s.edited) ORDER BY s.idx)
                                    FROM note_audio_segments s WHERE s.audio_id = a.id), '[]'::json) AS segments` : ''}
           FROM note_audio a
          WHERE a.note_id = $1 AND a.user_id = $2 AND a.status <> 'uploading' ORDER BY a.position, a.created_at`,
        [id, userId],
      );
      res.json(r.rows);
    } catch (err) {
      fail(res, err, 'Failed to list audio');
    }
  });
}
