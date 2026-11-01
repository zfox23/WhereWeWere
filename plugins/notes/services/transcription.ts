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
 *   - a request fails -> retried with exponential backoff, then `failed`
 *   - the server restarts mid-transcription -> `processing` rows are re-queued
 * Transcripts are stored as timestamped segments plus the joined text (which
 * is what search and the similarity analysis read).
 */

import fs from 'fs';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { pool, query } from '../../../server/src/db';
import path from 'path';
import { audioExtForMime, noteAudioDir, noteAudioPath } from './audioFiles';

export interface TranscriptionConfig {
  apiUrl: string;
  model: string;
  apiKey: string | null;
  /** ISO-639-1 hint; null lets the model auto-detect. */
  language: string | null;
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
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
const POLL_INTERVAL_MS = 30 * 1000;
/** A long recording on a busy GPU can take a while; this is an idle-socket limit. */
const SOCKET_TIMEOUT_MS = 3 * 60 * 60 * 1000;

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
      out.push({ startMs: segments[i].startMs, endMs: segments[j - 1].endMs, text: segments[i].text });
      collapsed += j - i - 1;
    } else {
      out.push(...segments.slice(i, j));
    }
    i = j;
  }
  return { segments: out, collapsed };
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
      segments.push({ startMs: Math.max(Math.round(start * 1000), 0), endMs: Math.max(Math.round(end * 1000), 0), text });
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

interface HttpResult {
  status: number;
  body: string;
}

function request(url: URL, options: http.RequestOptions, send: (req: http.ClientRequest) => void): Promise<HttpResult> {
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, options, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(parts).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(SOCKET_TIMEOUT_MS, () => req.destroy(new Error('Transcription request timed out')));
    req.on('error', reject);
    send(req);
  });
}

/** POST the file as multipart/form-data, streaming it from disk. */
async function postAudio(config: TranscriptionConfig, filePath: string, filename: string, mime: string): Promise<HttpResult> {
  const url = new URL(`${config.apiUrl}/audio/transcriptions`);
  const boundary = `----wwwaudio${crypto.randomBytes(12).toString('hex')}`;
  const fields: [string, string][] = [
    ['model', config.model],
    ['response_format', 'verbose_json'],
    ['timestamp_granularities[]', 'segment'],
    // Voice activity detection drops the silence and noise where Whisper models start to
    // hallucinate and loop, and is required by the service's batched mode (which stops a loop
    // from carrying across chunks) for any audio longer than 30 s.
    ['vad_filter', 'true'],
  ];
  if (config.language) fields.push(['language', config.language]);
  const safeName = filename.replace(/["\r\n]/g, '_');
  const head = Buffer.from(
    fields.map(([k, val]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${val}\r\n`).join('')
      + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const size = (await fs.promises.stat(filePath)).size;
  const headers: Record<string, string | number> = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': head.length + size + tail.length,
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return request(url, { method: 'POST', headers }, (req) => {
    req.write(head);
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => req.destroy(err));
    stream.on('end', () => req.end(tail));
    stream.pipe(req, { end: false });
  });
}

export async function transcribeFile(config: TranscriptionConfig, filePath: string, filename: string, mime: string): Promise<TranscriptionResult> {
  const res = await postAudio(config, filePath, filename, mime);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Transcription service returned ${res.status}: ${res.body.slice(0, 300)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new Error('Transcription service returned a non-JSON response');
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

async function saveTranscript(audioId: string, model: string, result: TranscriptionResult): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM note_audio_segments WHERE audio_id = $1', [audioId]);
    if (result.segments.length > 0) {
      await client.query(
        `INSERT INTO note_audio_segments (audio_id, idx, start_ms, end_ms, text)
         SELECT $1, t.idx - 1, t.s, t.e, t.txt
           FROM unnest($2::int[], $3::int[], $4::text[]) WITH ORDINALITY AS t(s, e, txt, idx)`,
        [audioId, result.segments.map((s) => s.startMs), result.segments.map((s) => s.endMs), result.segments.map((s) => s.text)],
      );
    }
    await client.query(
      `UPDATE note_audio SET status = 'done', error = NULL, transcript_text = $2, language = $3, model = $4,
              duration_ms = COALESCE(duration_ms, $5)
        WHERE id = $1`,
      [audioId, result.text, result.language, model, result.durationMs],
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
  try {
    const ext = audioExtForMime(row.mime);
    const file = ext ? noteAudioPath(row.user_id, row.id, ext) : null;
    if (!file || !fs.existsSync(file)) {
      await query(`UPDATE note_audio SET status = 'failed', error = 'The audio file is missing on the server' WHERE id = $1`, [row.id]);
      return;
    }
    const result = await transcribeFile(config, file, row.filename, row.mime);
    if (result.collapsedRepeats > 0) {
      console.warn(`Transcript of "${row.filename}" looped: folded ${result.collapsedRepeats} repeated segments. Check the transcription service's VAD / batched-mode settings.`);
    }
    await saveTranscript(row.id, config.model, result);
  } catch (err) {
    const attempts = row.attempts + 1;
    const message = (err instanceof Error ? err.message : 'Transcription failed').slice(0, 500);
    if (attempts >= MAX_ATTEMPTS) {
      await query(`UPDATE note_audio SET status = 'failed', attempts = $2, error = $3 WHERE id = $1`, [row.id, attempts, message]);
    } else {
      await query(
        `UPDATE note_audio SET status = 'pending', attempts = $2, error = $3,
                next_attempt_at = NOW() + ($4 || ' milliseconds')::interval WHERE id = $1`,
        [row.id, attempts, message, String(backoffMs(attempts))],
      );
    }
  }
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

let draining = false;

/** Work through every due `pending` row, one at a time. Returns how many were handled. */
export async function drainTranscriptionQueue(): Promise<number> {
  if (draining) return 0;
  draining = true;
  let handled = 0;
  try {
    await releaseIdleHeldAudio();
    for (let row = await claimNext(); row; row = await claimNext()) {
      await processRow(row);
      handled += 1;
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
