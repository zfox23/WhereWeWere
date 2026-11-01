/**
 * Backup v2 / restore of note audio.
 *
 * The ZIP carries, under plugins/notes/audio/:
 *   index.json          every audio row (metadata + transcript text + timestamped
 *                       segments), each naming its file
 *   <id>.<ext>          the original audio, byte for byte
 * Restore runs inside the notes backupImport transaction, after the notes
 * themselves. Every row is bound to the restoring user (whatever user id the
 * backup came from is ignored), each file's SHA-256 is checked against the
 * index before it is placed, and nothing is overwritten (rows keep ON CONFLICT
 * DO NOTHING semantics, so restoring twice is harmless).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BackupFileRef } from 'wwp-shared';
import { query } from '../../../server/src/db';
import { isUuid } from '../../../server/src/services/batching';
import { audioExtForMime, noteAudioPath, sha256File, storeNoteAudio } from './audioFiles';
import type { Queryable } from './notesRepo';

export const AUDIO_ZIP_DIR = 'audio';
export const AUDIO_INDEX = `${AUDIO_ZIP_DIR}/index.json`;

interface SegmentRow {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
  edited: boolean;
  speaker?: string | null;
  words?: [number, number, string][] | null;
  src?: number | null;
}

interface IndexEntry {
  id: string;
  note_id: string | null;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
  duration_ms: number | null;
  position: number;
  status: string;
  error: string | null;
  language: string | null;
  model: string | null;
  transcript_text: string;
  /** Names the user gave the speakers: { S1: "Dad" }. */
  speakers?: Record<string, string>;
  created_at: string;
  /** ZIP path of the original, relative to the plugin folder. */
  file: string;
  segments: SegmentRow[];
}

/** Everything the backup should ship for this user's note audio (empty when there is none). */
export async function planAudioBackup(userId: string): Promise<{ files: BackupFileRef[]; tempDir?: string }> {
  const rows = (await query(
    `SELECT a.id, a.note_id, a.filename, a.mime, a.bytes, a.sha256, a.duration_ms, a.position, a.status,
            a.error, a.language, a.model, a.transcript_text, a.speakers, a.created_at,
            COALESCE((SELECT json_agg(json_build_object('idx', s.idx, 'start_ms', s.start_ms, 'end_ms', s.end_ms,
                                                       'text', s.text, 'edited', s.edited,
                                                       'speaker', s.speaker, 'words', s.words, 'src', s.src) ORDER BY s.idx)
                        FROM note_audio_segments s WHERE s.audio_id = a.id), '[]'::json) AS segments
       FROM note_audio a
      WHERE a.user_id = $1 AND a.status <> 'uploading'
      ORDER BY a.created_at`,
    [userId],
  )).rows as (Omit<IndexEntry, 'file' | 'bytes'> & { bytes: string | number })[];
  if (rows.length === 0) return { files: [] };

  const files: BackupFileRef[] = [];
  const entries: IndexEntry[] = [];
  for (const row of rows) {
    const ext = audioExtForMime(row.mime);
    const abs = ext ? noteAudioPath(userId, row.id, ext) : null;
    if (!ext || !abs || !fs.existsSync(abs)) continue; // a row without its file can't be restored
    const file = `${AUDIO_ZIP_DIR}/${row.id}${ext}`;
    entries.push({ ...row, bytes: Number(row.bytes), file });
    files.push({ zipPath: file, absPath: abs });
  }
  if (entries.length === 0) return { files: [] };

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wwp-note-audio-backup-'));
  const indexPath = path.join(tempDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify({ version: 1, audio: entries }));
  files.unshift({ zipPath: AUDIO_INDEX, absPath: indexPath });
  return { files, tempDir };
}

const FILE_RE = /^audio\/[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

/** Speaker names from a backup: only `S<n>` keys with short text values. */
function cleanSpeakerNames(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (/^S\d{1,2}$/.test(k) && typeof v === 'string' && v.trim() && v.length <= 60) out[k] = v.trim();
    }
  }
  return out;
}

/** Word timings from a backup: [[startMs, endMs, "text"], ...], or null if it isn't that shape. */
function cleanWords(raw: unknown): [number, number, string][] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: [number, number, string][] = [];
  for (const w of raw) {
    if (!Array.isArray(w) || typeof w[0] !== 'number' || typeof w[1] !== 'number' || typeof w[2] !== 'string') return null;
    out.push([w[0], w[1], w[2]]);
  }
  return out;
}

/**
 * Restore audio from an extracted backup. `filesDir` is this plugin's folder in
 * the extracted ZIP. Returns how many audio files were restored; anything
 * skipped is reported through `errors`.
 */
export async function restoreAudioBackup(
  client: Queryable,
  userId: string,
  filesDir: string | undefined,
  errors: string[] = [],
): Promise<number> {
  if (!filesDir) return 0;
  const root = path.resolve(filesDir);
  const indexPath = path.join(root, AUDIO_INDEX);
  if (!fs.existsSync(indexPath)) return 0; // an older backup, or one without audio
  let entries: IndexEntry[];
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as { audio?: IndexEntry[] };
    entries = Array.isArray(parsed.audio) ? parsed.audio : [];
  } catch {
    errors.push('The audio index in this backup could not be read, so its audio was skipped.');
    return 0;
  }
  let restored = 0;
  for (const e of entries) {
    const label = typeof e?.filename === 'string' ? e.filename : String(e?.id ?? 'unknown');
    try {
      const ext = typeof e.mime === 'string' ? audioExtForMime(e.mime) : null;
      if (!isUuid(e.id) || !ext || typeof e.file !== 'string' || !FILE_RE.test(e.file) || !/^[0-9a-f]{64}$/i.test(String(e.sha256))) {
        errors.push(`Skipped audio "${label}": its entry in the backup is invalid.`);
        continue;
      }
      // The file name comes from the backup: stay inside the extracted folder.
      const inside = path.resolve(root, e.file);
      if (!inside.startsWith(root + path.sep)) {
        errors.push(`Skipped audio "${label}": unsafe file path.`);
        continue;
      }
      if (!fs.existsSync(inside)) {
        errors.push(`Skipped audio "${label}": the audio file is missing from the backup.`);
        continue;
      }
      const actual = await sha256File(inside);
      if (actual !== String(e.sha256).toLowerCase()) {
        errors.push(`Skipped audio "${label}": the file is corrupted (checksum mismatch).`);
        continue;
      }
      const noteId = typeof e.note_id === 'string' && isUuid(e.note_id)
        && ((await client.query('SELECT 1 FROM note_checkins WHERE id = $1 AND user_id = $2', [e.note_id, userId])).rowCount ?? 0) > 0
        ? e.note_id : null;
      const text = typeof e.transcript_text === 'string' ? e.transcript_text : '';
      // A transcript that never finished is simply queued again.
      const done = e.status === 'done' && text !== '';
      const speakers = cleanSpeakerNames(e.speakers);
      const hasSpeakers = done && Array.isArray(e.segments) && e.segments.some((seg) => typeof seg?.speaker === 'string');
      const inserted = await client.query(
        `INSERT INTO note_audio (id, user_id, note_id, filename, mime, bytes, sha256, duration_ms, position, status,
                                 error, language, model, transcript_text, created_at, speakers, diarization_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, $13, COALESCE($14::timestamptz, NOW()), $15::jsonb, $16)
         ON CONFLICT (id) DO NOTHING`,
        [
          e.id, userId, noteId, label.slice(0, 255), e.mime, Number(e.bytes) || 0, String(e.sha256).toLowerCase(),
          Number.isInteger(e.duration_ms) ? e.duration_ms : null, Number.isInteger(e.position) ? e.position : 0,
          done ? 'done' : 'pending', e.language ?? null, e.model ?? null, done ? text : '', e.created_at ?? null,
          JSON.stringify(hasSpeakers ? speakers : {}), hasSpeakers ? 'done' : 'none',
        ],
      );
      if ((inserted.rowCount ?? 0) === 0) continue; // already there
      await storeNoteAudio(userId, inside, e.id, ext, String(e.sha256));
      if (done && Array.isArray(e.segments)) {
        for (const s of e.segments) {
          if (!Number.isInteger(s?.idx) || typeof s.text !== 'string') continue;
          await client.query(
            `INSERT INTO note_audio_segments (audio_id, idx, start_ms, end_ms, text, edited, speaker, words, src)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) ON CONFLICT DO NOTHING`,
            [
              e.id, s.idx, Math.max(Number(s.start_ms) || 0, 0), Math.max(Number(s.end_ms) || 0, 0), s.text, s.edited === true,
              typeof s.speaker === 'string' && /^S\d{1,2}$/.test(s.speaker) ? s.speaker : null,
              cleanWords(s.words) ? JSON.stringify(cleanWords(s.words)) : null,
              Number.isInteger(s.src) ? s.src : null,
            ],
          );
        }
      }
      restored += 1;
    } catch (err) {
      errors.push(`Skipped audio "${label}": ${err instanceof Error ? err.message : 'restore failed'}.`);
    }
  }
  return restored;
}
