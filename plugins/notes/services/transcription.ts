/**
 * Notes plugin — speech-to-text for attached audio.
 *
 * Talks to an OpenAI-compatible `/audio/transcriptions` endpoint (the optional
 * `transcription` compose service runs faster-whisper behind one). The
 * original file is sent as-is: the server decodes whatever the browser
 * recorded (webm/opus, mp4/aac, ...), so nothing is transcoded on our side.
 *
 * A background queue works through `note_audio` rows in status `pending`:
 *   - no endpoint configured for the owner -> the row is parked, not failed
 *   - the service is unreachable or not ready (down, restarting, still installing its model) -> retried
 *     every few minutes without using up attempts, so an outage of any length fails nothing
 *   - the service refuses the audio itself (400/413/415/422) -> `failed` at once; retrying can't help
 *   - any other failure -> retried with exponential backoff, then `failed`
 *   - a transcription succeeds -> that user's files that failed by running out of attempts are queued
 *     again, since whatever was wrong with the service evidently is no longer
 *   - the server restarts mid-transcription -> `processing` rows are re-queued
 * Transcripts are stored as timestamped segments plus the joined text (which
 * is what search and the similarity analysis read).
 */

import fs from 'fs';
import path from 'path';
import { pool, query } from '../../../server/src/db';
import { audioExtForMime, noteAudioDir, noteAudioPath } from './audioFiles';
import { postMultipartFile, request } from './httpClient';
import { DiarizationError, diarizeAudio, getDiarizationConfig } from './diarization';
import { labelSpeakers, restoreOriginalSegments, type SpeakerSegment, type TimedWord, type Turn } from './speakers';

export interface TranscriptionConfig {
  apiUrl: string;
  model: string;
  apiKey: string | null;
  /** ISO-639-1 hint; null lets the model auto-detect. */
  language: string | null;
  /** Also ask for word timings (needed to split segments at a change of speaker). */
  wordTimestamps?: boolean;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  /** Word timings, when the service returned them. */
  words?: TimedWord[];
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  durationMs: number | null;
  segments: TranscriptSegment[];
  /** Segments dropped by collapseRepeatedSegments (0 for a healthy transcript). */
  collapsedRepeats: number;
}

export const MAX_ATTEMPTS = 8;
const UNCONFIGURED_RETRY_MS = 5 * 60 * 1000;
/** How soon to try again while the service is unreachable or not ready (no attempt is used up). */
export const UNAVAILABLE_RETRY_MS = 2 * 60 * 1000;

/**
 * Why a transcription request failed, which decides what the queue does next:
 *   unavailable - the service can't be reached or isn't ready: wait and retry, without using an attempt
 *   rejected    - the service refused this audio: retrying won't change that
 *   failed      - anything else: retry with backoff, a limited number of times
 */
export class TranscriptionError extends Error {
  constructor(message: string, readonly kind: 'unavailable' | 'rejected' | 'failed') {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/** Errors raised before any connection was made: the service is down, restarting, or the host is unreachable. */
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN', 'ETIMEDOUT']);

/** Classify a non-2xx answer from the transcription service. */
export function classifyTranscriptionStatus(status: number, body: string): TranscriptionError['kind'] {
  if (status === 503) return 'unavailable';
  // The bundled service (Speaches) answers 404 "... is not installed locally" while it is still
  // downloading the model on its first start.
  if (status === 404 && /not installed/i.test(body)) return 'unavailable';
  if (status === 400 || status === 413 || status === 415 || status === 422) return 'rejected';
  return 'failed';
}
const POLL_INTERVAL_MS = 30 * 1000;

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export async function getTranscriptionConfig(userId: string): Promise<TranscriptionConfig | null> {
  const result = await query(
    `SELECT key, value FROM plugin_settings
      WHERE user_id = $1 AND plugin_id = 'notes'
        AND key IN ('transcription_api_url', 'transcription_model', 'transcription_api_key', 'transcription_language')`,
    [userId],
  );
  const v: Record<string, unknown> = {};
  for (const row of result.rows) v[row.key] = row.value;
  const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : '');
  const apiUrl = normalizeUrl(str(v.transcription_api_url));
  const model = str(v.transcription_model);
  if (!apiUrl || !model) return null;
  return { apiUrl, model, apiKey: str(v.transcription_api_key) || null, language: str(v.transcription_language) || null };
}

/** Delay before retry number `attempts` (1-based): 30 s, 1 m, 2 m ... capped at 1 h. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(attempts - 1, 0), 60 * 60 * 1000);
}

/** Identical consecutive segments in a row at which we treat them as a transcription loop, not speech. */
export const LOOP_MIN_RUN = 4;

function loopKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Whisper-family models sometimes get stuck and emit the same segment hundreds of
 * times ("So. So. So. ..."), which would flood search and the similarity analysis
 * with junk. A run of LOOP_MIN_RUN or more identical consecutive segments is folded
 * into one segment covering the whole run. Genuine repetition rarely looks like this:
 * speech is transcribed into varied sentences, not 600 copies of one.
 */
export function collapseRepeatedSegments(segments: TranscriptSegment[]): { segments: TranscriptSegment[]; collapsed: number } {
  const out: TranscriptSegment[] = [];
  let collapsed = 0;
  for (let i = 0; i < segments.length; ) {
    const key = loopKey(segments[i].text);
    let j = i + 1;
    while (key !== '' && j < segments.length && loopKey(segments[j].text) === key) j += 1;
    if (j - i >= LOOP_MIN_RUN) {
      out.push({ startMs: segments[i].startMs, endMs: segments[j - 1].endMs, text: segments[i].text, ...(segments[i].words ? { words: segments[i].words } : {}) });
      collapsed += j - i - 1;
    } else {
      out.push(...segments.slice(i, j));
    }
    i = j;
  }
  return { segments: out, collapsed };
}

/** `{ word, start, end }` entries (seconds) -> timings in milliseconds; anything malformed is skipped. */
function parseWords(raw: unknown): TimedWord[] {
  if (!Array.isArray(raw)) return [];
  const out: TimedWord[] = [];
  for (const w of raw as Record<string, unknown>[]) {
    const text = typeof w?.word === 'string' ? w.word : typeof w?.text === 'string' ? w.text : '';
    if (!text.trim() || typeof w.start !== 'number' || typeof w.end !== 'number') continue;
    out.push({ startMs: Math.max(Math.round(w.start * 1000), 0), endMs: Math.max(Math.round(w.end * 1000), 0), text: text.startsWith(' ') ? text : ` ${text}` });
  }
  return out;
}

/** Normalize a verbose_json response (segments in seconds) into our shape. */
export function parseTranscriptionResponse(raw: unknown): TranscriptionResult {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const duration = typeof body.duration === 'number' && Number.isFinite(body.duration) ? Math.round(body.duration * 1000) : null;
  const segments: TranscriptSegment[] = [];
  if (Array.isArray(body.segments)) {
    for (const s of body.segments as Record<string, unknown>[]) {
      const text = typeof s?.text === 'string' ? s.text.trim() : '';
      if (!text) continue;
      const start = typeof s.start === 'number' ? s.start : 0;
      const end = typeof s.end === 'number' ? s.end : start;
      const segWords = parseWords(s.words);
      segments.push({
        startMs: Math.max(Math.round(start * 1000), 0),
        endMs: Math.max(Math.round(end * 1000), 0),
        text,
        ...(segWords.length > 0 ? { words: segWords } : {}),
      });
    }
  }
  // Some servers return word timings only at the top level: give each segment the words inside it.
  const topWords = parseWords(body.words);
  if (topWords.length > 0 && segments.every((seg) => !seg.words)) {
    for (const seg of segments) {
      const inside = topWords.filter((w) => {
        const mid = (w.startMs + w.endMs) / 2;
        return mid >= seg.startMs && mid < seg.endMs + 1;
      });
      if (inside.length > 0) seg.words = inside;
    }
  }
  let text = typeof body.text === 'string' ? body.text.trim() : '';
  if (segments.length === 0 && text) segments.push({ startMs: 0, endMs: duration ?? 0, text });
  const folded = collapseRepeatedSegments(segments);
  // The service's own `text` still contains every repeat, so rebuild it from the cleaned segments.
  if (!text || folded.collapsed > 0) text = folded.segments.map((s) => s.text).join(' ');
  return {
    text,
    language: typeof body.language === 'string' && body.language ? body.language : null,
    durationMs: duration,
    segments: folded.segments,
    collapsedRepeats: folded.collapsed,
  };
}

/** POST the file as multipart/form-data, streaming it from disk. */
async function postAudio(config: TranscriptionConfig, filePath: string, filename: string, mime: string) {
  const fields: [string, string][] = [
    ['model', config.model],
    ['response_format', 'verbose_json'],
    ['timestamp_granularities[]', 'segment'],
  ];
  // Word timings let a segment be split where the speaker changes (only asked for when speaker identification is on).
  if (config.wordTimestamps) fields.push(['timestamp_granularities[]', 'word']);
  if (config.language) fields.push(['language', config.language]);
  return postMultipartFile(
    new URL(`${config.apiUrl}/audio/transcriptions`),
    fields,
    { path: filePath, filename, mime },
    config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    'Transcription request timed out',
  );
}

export async function transcribeFile(config: TranscriptionConfig, filePath: string, filename: string, mime: string): Promise<TranscriptionResult> {
  let res;
  try {
    res = await postAudio(config, filePath, filename, mime);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    const message = err instanceof Error ? err.message : 'unknown error';
    if (code && UNREACHABLE_CODES.has(code)) {
      throw new TranscriptionError(`Could not reach the transcription service (${message}); will keep trying until it is back`, 'unavailable');
    }
    throw new TranscriptionError(`Transcription request failed: ${message}`, 'failed');
  }
  if (res.status < 200 || res.status >= 300) {
    throw new TranscriptionError(`Transcription service returned ${res.status}: ${res.body.slice(0, 300)}`, classifyTranscriptionStatus(res.status, res.body));
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new TranscriptionError('Transcription service returned a non-JSON response', 'failed');
  }
  return parseTranscriptionResponse(json);
}

/** Reachability check for the settings screen; lists models when the server supports it. */
export async function testTranscriptionConfig(config: Pick<TranscriptionConfig, 'apiUrl' | 'model' | 'apiKey'>): Promise<{ ok: boolean; message: string }> {
  try {
    const headers: Record<string, string> = {};
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const res = await request(new URL(`${normalizeUrl(config.apiUrl)}/models`), { method: 'GET', headers }, (req) => req.end());
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'The service rejected the API key.' };
    if (res.status < 200 || res.status >= 300) return { ok: false, message: `The service answered ${res.status} for /models.` };
    let ids: string[] = [];
    try {
      const data = (JSON.parse(res.body) as { data?: { id?: string }[] }).data;
      ids = Array.isArray(data) ? data.map((m) => String(m.id)) : [];
    } catch { /* not every server lists models */ }
    if (ids.length > 0 && !ids.includes(config.model)) {
      return {
        ok: true,
        message: `Connected, but "${config.model}" is not installed on the service. The bundled service installs the model named by TRANSCRIPTION_MODEL when it starts; make sure the two match (see docs/audio-notes.md).`,
      };
    }
    return { ok: true, message: 'Connected.' };
  } catch (err) {
    return { ok: false, message: `Could not reach the service: ${err instanceof Error ? err.message : 'unknown error'}` };
  }
}

interface AudioRow {
  id: string;
  user_id: string;
  filename: string;
  mime: string;
  attempts: number;
}

async function claimNext(): Promise<AudioRow | null> {
  const r = await query(
    `UPDATE note_audio SET status = 'processing'
      WHERE id = (SELECT id FROM note_audio
                   WHERE status = 'pending' AND next_attempt_at <= NOW()
                     -- Audio of a user with no endpoint set up just waits; it is picked
                     -- up on the next poll once they save one, with no delay to unwind.
                     AND (SELECT COUNT(*) FROM plugin_settings ps
                           WHERE ps.user_id = note_audio.user_id AND ps.plugin_id = 'notes'
                             AND ps.key IN ('transcription_api_url', 'transcription_model')
                             AND jsonb_typeof(ps.value) = 'string' AND btrim(ps.value #>> '{}') <> '') = 2
                   ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, user_id, filename, mime, attempts`,
  );
  return (r.rows[0] as AudioRow | undefined) ?? null;
}

async function saveTranscript(audioId: string, model: string, result: TranscriptionResult, diarize: boolean): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM note_audio_segments WHERE audio_id = $1', [audioId]);
    if (result.segments.length > 0) {
      await client.query(
        `INSERT INTO note_audio_segments (audio_id, idx, start_ms, end_ms, text, words, src)
         SELECT $1, t.idx - 1, t.s, t.e, t.txt, NULLIF(t.w, '')::jsonb, t.idx - 1
           FROM unnest($2::int[], $3::int[], $4::text[], $5::text[]) WITH ORDINALITY AS t(s, e, txt, w, idx)`,
        [
          audioId,
          result.segments.map((s) => s.startMs),
          result.segments.map((s) => s.endMs),
          result.segments.map((s) => s.text),
          result.segments.map((s) => (s.words ? JSON.stringify(s.words.map((w) => [w.startMs, w.endMs, w.text])) : '')),
        ],
      );
    }
    // A new transcript has no speakers yet; queue the speaker pass if it is set up.
    await client.query(
      `UPDATE note_audio SET status = 'done', error = NULL, transcript_text = $2, language = $3, model = $4,
              duration_ms = COALESCE(duration_ms, $5), speakers = '{}'::jsonb,
              diarization_status = $6, diarization_error = NULL, diarization_attempts = 0, diarization_next_at = NOW()
        WHERE id = $1`,
      [audioId, result.text, result.language, model, result.durationMs, diarize ? 'pending' : 'none'],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function processRow(row: AudioRow): Promise<void> {
  const config = await getTranscriptionConfig(row.user_id);
  if (!config) {
    // Not set up (yet): keep the audio queued without burning attempts.
    await query(
      `UPDATE note_audio SET status = 'pending', next_attempt_at = NOW() + ($2 || ' milliseconds')::interval WHERE id = $1`,
      [row.id, String(UNCONFIGURED_RETRY_MS)],
    );
    return;
  }
  let transcribed = false;
  try {
    const ext = audioExtForMime(row.mime);
    const file = ext ? noteAudioPath(row.user_id, row.id, ext) : null;
    if (!file || !fs.existsSync(file)) {
      await query(`UPDATE note_audio SET status = 'failed', error = 'The audio file is missing on the server' WHERE id = $1`, [row.id]);
      return;
    }
    // Speaker identification, if set up, needs word timings to split a segment where the speaker changes.
    const diarization = await getDiarizationConfig(row.user_id);
    const result = await transcribeFile({ ...config, wordTimestamps: diarization !== null }, file, row.filename, row.mime);
    if (result.collapsedRepeats > 0) {
      console.warn(`Transcript of "${row.filename}" looped: folded ${result.collapsedRepeats} repeated segments. Check the transcription service's VAD / batched-mode settings.`);
    }
    await saveTranscript(row.id, config.model, result, diarization !== null);
    transcribed = true;
  } catch (err) {
    const kind = err instanceof TranscriptionError ? err.kind : 'failed';
    const message = (err instanceof Error ? err.message : 'Transcription failed').slice(0, 500);
    if (kind === 'unavailable') {
      await query(
        `UPDATE note_audio SET status = 'pending', error = $2, next_attempt_at = NOW() + ($3 || ' milliseconds')::interval WHERE id = $1`,
        [row.id, message, String(UNAVAILABLE_RETRY_MS)],
      );
      return;
    }
    const attempts = row.attempts + 1;
    if (kind === 'rejected') {
      // Kept below MAX_ATTEMPTS so a later success elsewhere doesn't queue it again (see requeueExhausted).
      await query(`UPDATE note_audio SET status = 'failed', attempts = $2, error = $3 WHERE id = $1`,
        [row.id, Math.min(attempts, MAX_ATTEMPTS - 1), message]);
    } else if (attempts >= MAX_ATTEMPTS) {
      await query(`UPDATE note_audio SET status = 'failed', attempts = $2, error = $3 WHERE id = $1`, [row.id, attempts, message]);
    } else {
      await query(
        `UPDATE note_audio SET status = 'pending', attempts = $2, error = $3,
                next_attempt_at = NOW() + ($4 || ' milliseconds')::interval WHERE id = $1`,
        [row.id, attempts, message, String(backoffMs(attempts))],
      );
    }
  }
  // Outside the try: a hiccup here must not count against the file that was just transcribed.
  if (transcribed) await requeueExhausted(row.user_id).catch((err) => console.error('Re-queueing failed audio failed:', err));
}

/**
 * A transcription just worked, so the service is healthy again: give this user's files that failed
 * by running out of attempts (not ones the service refused, which stop short of MAX_ATTEMPTS) another go.
 */
async function requeueExhausted(userId: string): Promise<void> {
  await query(
    `UPDATE note_audio SET status = 'pending', attempts = 0, next_attempt_at = NOW()
      WHERE user_id = $1 AND status = 'failed' AND attempts >= $2`,
    [userId, MAX_ATTEMPTS],
  );
}

/**
 * Import runs hold their audio (next_attempt_at = infinity) until the run is
 * done. Release a user's held audio once none of it has been touched for an
 * hour, so an import abandoned halfway doesn't leave files untranscribed forever.
 */
const HELD_IDLE_MS = 60 * 60 * 1000;

export async function releaseIdleHeldAudio(): Promise<number> {
  const r = await query(
    `UPDATE note_audio a SET next_attempt_at = NOW()
      WHERE a.next_attempt_at = 'infinity' AND a.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM note_audio b
                         WHERE b.user_id = a.user_id AND b.next_attempt_at = 'infinity'
                           AND b.updated_at > NOW() - ($1 || ' milliseconds')::interval)`,
    [String(HELD_IDLE_MS)],
  );
  return r.rowCount ?? 0;
}

/** An import run finished: let the worker have these files. */
export async function releaseHeldAudio(userId: string, audioIds: string[]): Promise<number> {
  if (audioIds.length === 0) return 0;
  const r = await query(
    `UPDATE note_audio SET next_attempt_at = NOW()
      WHERE user_id = $1 AND id = ANY($2::uuid[]) AND next_attempt_at = 'infinity' AND status = 'pending'`,
    [userId, audioIds],
  );
  if ((r.rowCount ?? 0) > 0) kickTranscription();
  return r.rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Speaker identification: runs after a transcript is saved, when the user has set up the service.
// ---------------------------------------------------------------------------

const DIARIZATION_MAX_ATTEMPTS = 5;

interface DiarizeRow {
  id: string;
  user_id: string;
  filename: string;
  mime: string;
  diarization_attempts: number;
}

async function claimNextDiarization(): Promise<DiarizeRow | null> {
  const r = await query(
    `UPDATE note_audio SET diarization_status = 'processing'
      WHERE id = (SELECT id FROM note_audio
                   WHERE status = 'done' AND diarization_status = 'pending' AND diarization_next_at <= NOW()
                     -- Only for users who have set up the service; their transcripts wait until they do.
                     AND EXISTS (SELECT 1 FROM plugin_settings ps
                                  WHERE ps.user_id = note_audio.user_id AND ps.plugin_id = 'notes'
                                    AND ps.key = 'diarization_api_url'
                                    AND jsonb_typeof(ps.value) = 'string' AND btrim(ps.value #>> '{}') <> '')
                   ORDER BY diarization_next_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, user_id, filename, mime, diarization_attempts`,
  );
  return (r.rows[0] as DiarizeRow | undefined) ?? null;
}

interface StoredSegment {
  idx: number;
  start_ms: number;
  end_ms: number;
  text: string;
  edited: boolean;
  words: [number, number, string][] | null;
  src: number | null;
}

function toSpeakerSegment(r: StoredSegment): SpeakerSegment {
  return {
    startMs: r.start_ms,
    endMs: r.end_ms,
    text: r.text,
    edited: r.edited,
    ...(r.words ? { words: r.words.map(([startMs, endMs, text]) => ({ startMs, endMs, text })) } : {}),
    ...(r.src !== null ? { src: r.src } : {}),
  };
}

/**
 * Label the stored transcript with `turns` and write it back, in one transaction holding the audio
 * row's lock. Transcript edits take the same lock, so an edit saved while the service was working is
 * read here (and respected) instead of being overwritten, and an editor never sees half-written segments.
 */
async function applySpeakerTurns(audioId: string, turns: Turn[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query(
      `SELECT 1 FROM note_audio WHERE id = $1 AND status = 'done' AND diarization_status = 'processing' FOR UPDATE`,
      [audioId],
    );
    if (row.rowCount === 0) {
      // Deleted, or transcribed again meanwhile (which queues a fresh speaker pass): nothing to label.
      await client.query('ROLLBACK');
      return;
    }
    const stored = (await client.query(
      'SELECT idx, start_ms, end_ms, text, edited, words, src FROM note_audio_segments WHERE audio_id = $1 ORDER BY idx',
      [audioId],
    )).rows as StoredSegment[];
    // Text the user corrected must not be re-cut: label whole segments only. Otherwise start again from the
    // transcriber's own segments (undoing any earlier split) and cut at each change of speaker.
    const edited = stored.some((s) => s.edited);
    const base = stored.map(toSpeakerSegment);
    const { segments, speakers } = labelSpeakers(edited ? base : restoreOriginalSegments(base), turns, { split: !edited });
    await client.query('DELETE FROM note_audio_segments WHERE audio_id = $1', [audioId]);
    if (segments.length > 0) {
      await client.query(
        `INSERT INTO note_audio_segments (audio_id, idx, start_ms, end_ms, text, edited, speaker, words, src)
         SELECT $1, t.idx - 1, t.s, t.e, t.txt, t.ed, t.sp, NULLIF(t.w, '')::jsonb, t.src
           FROM unnest($2::int[], $3::int[], $4::text[], $5::boolean[], $6::text[], $7::text[], $8::int[])
                WITH ORDINALITY AS t(s, e, txt, ed, sp, w, src, idx)`,
        [
          audioId,
          segments.map((s) => s.startMs),
          segments.map((s) => s.endMs),
          segments.map((s) => s.text),
          segments.map((s) => s.edited === true),
          segments.map((s) => s.speaker ?? null),
          segments.map((s) => (s.words ? JSON.stringify(s.words.map((w) => [w.startMs, w.endMs, w.text])) : '')),
          segments.map((s) => s.src ?? null),
        ],
      );
    }
    // Names the user gave belong to the previous labelling; a fresh one starts unnamed.
    await client.query(
      `UPDATE note_audio SET speakers = '{}'::jsonb, diarization_status = 'done', diarization_attempts = 0,
              diarization_error = $2 WHERE id = $1`,
      [audioId, speakers.length === 0 ? 'No speech was detected, so no speakers were found.' : null],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function processDiarization(row: DiarizeRow): Promise<void> {
  const config = await getDiarizationConfig(row.user_id);
  if (!config) {
    await query(`UPDATE note_audio SET diarization_status = 'none' WHERE id = $1`, [row.id]);
    return;
  }
  try {
    const ext = audioExtForMime(row.mime);
    const file = ext ? noteAudioPath(row.user_id, row.id, ext) : null;
    if (!file || !fs.existsSync(file)) throw new DiarizationError('The audio file is missing on the server', false);
    const turns = await diarizeAudio(config, file, row.filename, row.mime);
    await applySpeakerTurns(row.id, turns);
  } catch (err) {
    const retryable = !(err instanceof DiarizationError) || err.retryable;
    const attempts = row.diarization_attempts + 1;
    const message = (err instanceof Error ? err.message : 'Speaker identification failed').slice(0, 500);
    if (retryable && attempts < DIARIZATION_MAX_ATTEMPTS) {
      await query(
        `UPDATE note_audio SET diarization_status = 'pending', diarization_attempts = $2, diarization_error = $3,
                diarization_next_at = NOW() + ($4 || ' milliseconds')::interval WHERE id = $1`,
        [row.id, attempts, message, String(backoffMs(attempts))],
      );
    } else {
      await query(`UPDATE note_audio SET diarization_status = 'failed', diarization_attempts = $2, diarization_error = $3 WHERE id = $1`, [row.id, attempts, message]);
    }
  }
}

/** Queue (or re-queue) speaker identification for a finished transcript. False when it can't run. */
export async function requestDiarization(audioId: string, userId: string): Promise<'queued' | 'not_configured' | 'not_found'> {
  // Unknown, someone else's, or not yet transcribed audio is "not found" whatever the settings are.
  const exists = await query(`SELECT 1 FROM note_audio WHERE id = $1 AND user_id = $2 AND status = 'done'`, [audioId, userId]);
  if ((exists.rowCount ?? 0) === 0) return 'not_found';
  if (!(await getDiarizationConfig(userId))) return 'not_configured';
  const r = await query(
    `UPDATE note_audio SET diarization_status = 'pending', diarization_attempts = 0, diarization_error = NULL, diarization_next_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status = 'done' AND diarization_status <> 'processing'`,
    [audioId, userId],
  );
  if ((r.rowCount ?? 0) === 0) return 'not_found';
  kickTranscription();
  return 'queued';
}

let draining = false;

/** Work through every due `pending` row, one at a time. Returns how many were handled. */
export async function drainTranscriptionQueue(): Promise<number> {
  if (draining) return 0;
  draining = true;
  let handled = 0;
  try {
    await releaseIdleHeldAudio();
    for (;;) {
      const row = await claimNext();
      if (row) {
        await processRow(row);
        handled += 1;
        continue;
      }
      // Nothing left to transcribe: identify speakers on transcripts that are waiting for it.
      const toLabel = await claimNextDiarization();
      if (!toLabel) break;
      await processDiarization(toLabel);
    }
  } finally {
    draining = false;
  }
  return handled;
}

let started = false;

const ABANDONED_UPLOAD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Drop upload sessions nobody finished for a week (and their partial files).
 * Safe: the browser keeps its own copy until the server confirms, and starts
 * a fresh session if the old one is gone.
 */
export async function cleanupAbandonedUploads(): Promise<number> {
  const r = await query(
    `DELETE FROM note_audio WHERE status = 'uploading' AND created_at < NOW() - ($1 || ' milliseconds')::interval
      RETURNING id, user_id`,
    [String(ABANDONED_UPLOAD_MS)],
  );
  for (const row of r.rows as { id: string; user_id: string }[]) {
    fs.unlink(path.join(noteAudioDir(row.user_id), '.partial', `${row.id}.part`), () => {});
  }
  return r.rowCount ?? 0;
}

/** Nudge the worker after new work arrives; a no-op until the server started it. */
export function kickTranscription(): void {
  if (!started) return;
  drainTranscriptionQueue().catch((err) => console.error('Transcription queue failed:', err));
}

/** Server start: re-queue rows a restart interrupted, then poll for due work. */
export async function startTranscriptionWorker(): Promise<void> {
  if (started) return;
  started = true;
  await query(`UPDATE note_audio SET status = 'pending', next_attempt_at = NOW() WHERE status = 'processing'`);
  await query(`UPDATE note_audio SET diarization_status = 'pending', diarization_next_at = NOW() WHERE diarization_status = 'processing'`);
  setInterval(kickTranscription, POLL_INTERVAL_MS).unref();
  kickTranscription();
  const sweep = () => cleanupAbandonedUploads().catch((err) => console.error('Upload cleanup failed:', err));
  void sweep();
  setInterval(sweep, 6 * 60 * 60 * 1000).unref();
}

/** Put one file back in the queue (manual retry / re-transcribe). */
export async function requeueAudio(audioId: string, userId: string): Promise<boolean> {
  const r = await query(
    `UPDATE note_audio SET status = 'pending', attempts = 0, error = NULL, next_attempt_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'done', 'failed')`,
    [audioId, userId],
  );
  if ((r.rowCount ?? 0) > 0) kickTranscription();
  return (r.rowCount ?? 0) > 0;
}
