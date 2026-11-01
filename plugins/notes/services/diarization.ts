/**
 * Notes plugin — talking to the optional speaker-diarization service
 * (`diarization/`, pyannote 3.1): which speaker was talking when.
 *
 * Settings are per user (Settings > Integrations), kept in plugin_settings:
 *   diarization_api_url       e.g. http://diarization:8001  (empty = speaker identification is off)
 *   diarization_min_speakers  optional hint
 *   diarization_max_speakers  optional hint (equal to min means "exactly this many")
 */

import { query } from '../../../server/src/db';
import { postMultipartFile, request } from './httpClient';
import type { Turn } from './speakers';

export interface DiarizationConfig {
  apiUrl: string;
  minSpeakers: number | null;
  maxSpeakers: number | null;
}

/** A failure of the diarization call, and whether trying again later could help. */
export class DiarizationError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'DiarizationError';
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function hint(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}

export async function getDiarizationConfig(userId: string): Promise<DiarizationConfig | null> {
  const result = await query(
    `SELECT key, value FROM plugin_settings
      WHERE user_id = $1 AND plugin_id = 'notes'
        AND key IN ('diarization_api_url', 'diarization_min_speakers', 'diarization_max_speakers')`,
    [userId],
  );
  const v: Record<string, unknown> = {};
  for (const row of result.rows) v[row.key] = row.value;
  const apiUrl = typeof v.diarization_api_url === 'string' ? normalizeUrl(v.diarization_api_url) : '';
  if (!apiUrl) return null;
  return { apiUrl, minSpeakers: hint(v.diarization_min_speakers), maxSpeakers: hint(v.diarization_max_speakers) };
}

/** The form fields that tell the service how many speakers to expect. */
export function speakerHintFields(config: Pick<DiarizationConfig, 'minSpeakers' | 'maxSpeakers'>): [string, string][] {
  const { minSpeakers: lo, maxSpeakers: hi } = config;
  if (lo !== null && hi !== null && lo === hi) return [['num_speakers', String(lo)]];
  const fields: [string, string][] = [];
  if (lo !== null) fields.push(['min_speakers', String(lo)]);
  if (hi !== null) fields.push(['max_speakers', String(hi)]);
  return fields;
}

/** The service's turns, validated: anything malformed is dropped. */
export function parseTurns(raw: unknown): Turn[] {
  const turns = (raw && typeof raw === 'object' ? (raw as { turns?: unknown }).turns : null) ?? [];
  if (!Array.isArray(turns)) return [];
  const out: Turn[] = [];
  for (const t of turns as Record<string, unknown>[]) {
    if (typeof t?.start === 'number' && typeof t.end === 'number' && typeof t.speaker === 'string' && t.end > t.start && t.start >= 0) {
      out.push({ start: t.start, end: t.end, speaker: t.speaker });
    }
  }
  return out;
}

function detail(body: string): string {
  try {
    const d = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof d === 'string') return d;
  } catch {
    // not JSON
  }
  return body.slice(0, 300);
}

export async function diarizeAudio(config: DiarizationConfig, filePath: string, filename: string, mime: string): Promise<Turn[]> {
  let res;
  try {
    res = await postMultipartFile(
      new URL(`${config.apiUrl}/v1/diarize`),
      speakerHintFields(config),
      { path: filePath, filename, mime },
      {},
      'Speaker identification timed out',
    );
  } catch (err) {
    throw new DiarizationError(`Could not reach the diarization service: ${err instanceof Error ? err.message : 'unknown error'}`, true);
  }
  if (res.status < 200 || res.status >= 300) {
    // 503: still loading or not set up yet (a missing token won't fix itself, but the user may fix it, so keep retrying
    // a few times); 4xx: the audio itself was refused, which retrying won't change.
    const retryable = res.status >= 500;
    throw new DiarizationError(`Diarization service returned ${res.status}: ${detail(res.body)}`, retryable);
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new DiarizationError('Diarization service returned a non-JSON response', true);
  }
  return parseTurns(json);
}

/** Reachability + readiness check for the settings screen. */
export async function testDiarizationConfig(apiUrl: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await request(new URL(`${normalizeUrl(apiUrl)}/health`), { method: 'GET' }, (req) => req.end());
    if (res.status < 200 || res.status >= 300) return { ok: false, message: `The service answered ${res.status} for /health.` };
    const health = JSON.parse(res.body) as { status?: string; pipeline_loaded?: boolean; error?: string; device?: string };
    if (health.status === 'error') return { ok: false, message: `The service is running but its model is not available: ${health.error ?? 'unknown error'}` };
    if (!health.pipeline_loaded) return { ok: true, message: 'Connected. The model is still loading (the first start downloads it); try again shortly.' };
    return { ok: true, message: `Connected, model ready${health.device ? ` (${health.device})` : ''}.` };
  } catch (err) {
    return { ok: false, message: `Could not reach the service: ${err instanceof Error ? err.message : 'unknown error'}` };
  }
}
