/**
 * Audio-file import — the server side of Settings > Notes > Import audio.
 * Mounted on the import router (/api/v1/import/notes).
 *
 *   POST /audio/plan     { files: [{ name, size, last_modified, sha256 }], fallback_timezone }
 *                        -> rows: title, date/time, zone, duplicate flags (no audio bytes involved)
 *   POST /audio          { audio_id, title, checked_in_at, timezone, filename, tags }
 *                        create the note for one uploaded file and attach it (idempotent)
 *   POST /audio/finish   { audio_ids }
 *                        the run is over: release those files to the transcriber
 *
 * The browser uploads each file with the normal resumable upload endpoints
 * (held, so nothing is transcribed mid-run), then calls `POST /audio` for it.
 */

import type { Request, Response, Router } from 'express';
import { isValidTimeZone } from 'wwp-shared';
import { pool, query } from '../../server/src/db';
import { isUuid } from '../../server/src/services/batching';
import { loadTimezoneAnchors } from '../../server/src/services/timezoneAnchors';
import { currentUserId } from '../../server/src/auth/context';
import { MAX_TITLE_LENGTH } from './manifest';
import {
  InputError, addTagsToNotes, attachAudio, normalizeTagNames, resolveTags,
} from './services/notesRepo';
import { markAudioDuplicates, planAudioImportRow, type AudioFileMeta } from './services/importAudio';
import { getTranscriptionConfig, releaseHeldAudio } from './services/transcription';

export const MAX_AUDIO_IMPORT_FILES = 5000;

function fail(res: Response, err: unknown, fallback: string) {
  if (err instanceof InputError) return res.status(400).json({ error: err.message });
  console.error(`${fallback}:`, err);
  return res.status(500).json({ error: fallback });
}

/** The `files` array of a plan request, validated. */
export function parseFileMetas(value: unknown): AudioFileMeta[] {
  if (!Array.isArray(value) || value.length === 0) throw new InputError('files must be a non-empty array');
  if (value.length > MAX_AUDIO_IMPORT_FILES) throw new InputError(`Plan at most ${MAX_AUDIO_IMPORT_FILES} files at a time`);
  return value.map((raw) => {
    const f = (raw ?? {}) as Record<string, unknown>;
    if (typeof f.name !== 'string' || !f.name || f.name.length > 1000) throw new InputError('Every file needs a name');
    const size = Number(f.size);
    const lm = Number(f.last_modified);
    return {
      name: f.name,
      size: Number.isFinite(size) ? size : 0,
      lastModified: f.last_modified != null && Number.isFinite(lm) && lm > 0 ? lm : null,
      sha256: typeof f.sha256 === 'string' ? f.sha256 : null,
    };
  });
}

export function registerAudioImportRoutes(router: Router): void {
  router.post('/audio/plan', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const metas = parseFileMetas(req.body?.files);
      const fallback = typeof req.body?.fallback_timezone === 'string' && isValidTimeZone(req.body.fallback_timezone)
        ? req.body.fallback_timezone
        : 'UTC';
      const hashes = [...new Set(metas.flatMap((m) => (m.sha256 && /^[0-9a-f]{64}$/i.test(m.sha256) ? [m.sha256.toLowerCase()] : [])))];
      const [anchors, existing] = await Promise.all([
        loadTimezoneAnchors(userId),
        // Only audio that is attached to a note counts as imported; leftovers of an interrupted run don't.
        hashes.length === 0
          ? Promise.resolve({ rows: [] as { sha256: string }[] })
          : query('SELECT DISTINCT sha256 FROM note_audio WHERE user_id = $1 AND note_id IS NOT NULL AND sha256 = ANY($2::text[])', [userId, hashes]),
      ]);
      const rows = metas.map((meta, index) => planAudioImportRow({ index, meta, anchors, fallbackTimezone: fallback }));
      markAudioDuplicates(rows, new Set(existing.rows.map((r) => r.sha256)));
      res.json({
        total: rows.length,
        selected: rows.filter((r) => r.selected_default).length,
        fallback_count: rows.filter((r) => r.tz_source === 'fallback').length,
        duplicate_count: rows.filter((r) => r.duplicate).length,
        rows,
      });
    } catch (err) {
      fail(res, err, 'Failed to plan the audio import');
    }
  });

  router.post('/audio', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body.audio_id !== 'string' || !isUuid(body.audio_id)) throw new InputError('audio_id must be a uuid');
      const at = new Date(String(body.checked_in_at));
      if (Number.isNaN(at.getTime())) throw new InputError('checked_in_at must be a valid date-time');
      if (typeof body.timezone !== 'string' || !isValidTimeZone(body.timezone)) throw new InputError('timezone must be a valid IANA timezone');
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
      if (rawTitle.length > MAX_TITLE_LENGTH) throw new InputError(`title is too long (max ${MAX_TITLE_LENGTH} characters)`);
      const filename = typeof body.filename === 'string' ? body.filename.slice(0, 500) : null;
      const tags = normalizeTagNames(body.tags);

      const audio = await query('SELECT status, note_id FROM note_audio WHERE id = $1 AND user_id = $2', [body.audio_id, userId]);
      if (audio.rowCount === 0) return res.status(404).json({ error: 'Audio not found' });
      // A retry after a lost response: the note exists already.
      if (audio.rows[0].note_id) return res.json({ note_id: audio.rows[0].note_id, already: true });
      if (audio.rows[0].status === 'uploading') return res.status(409).json({ error: 'The upload is not finished yet' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const note = await client.query(
          `INSERT INTO note_checkins (user_id, title, body, checked_in_at, checkin_timezone, source, source_filename)
           VALUES ($1, $2, '', $3, $4, 'import', $5) RETURNING id`,
          [userId, rawTitle || null, at.toISOString(), body.timezone, filename],
        );
        const noteId = note.rows[0].id as string;
        await attachAudio(client, userId, noteId, [body.audio_id]);
        await addTagsToNotes(client, [noteId], await resolveTags(client, userId, tags));
        await client.query('COMMIT');
        res.status(201).json({ note_id: noteId, already: false });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      fail(res, err, 'Failed to import the audio file');
    }
  });

  router.post('/audio/finish', async (req: Request, res: Response) => {
    const userId = currentUserId();
    try {
      const ids = Array.isArray(req.body?.audio_ids) ? (req.body.audio_ids as unknown[]).filter((x): x is string => typeof x === 'string' && isUuid(x)) : [];
      const released = await releaseHeldAudio(userId, ids.slice(0, MAX_AUDIO_IMPORT_FILES));
      res.json({ released, transcription_configured: (await getTranscriptionConfig(userId)) !== null });
    } catch (err) {
      fail(res, err, 'Failed to start transcription');
    }
  });
}
