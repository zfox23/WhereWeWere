/**
 * Notes plugin — text embeddings from an OpenAI-compatible `/embeddings`
 * endpoint (e.g. a vLLM instance serving an embedding model).
 *
 * A note longer than one chunk is embedded chunk by chunk and mean-pooled,
 * so every note ends up as one L2-normalized vector.
 */

import { query } from '../../../server/src/db';
import { getLlmSettings } from '../../../server/src/services/llmClient';

export interface EmbeddingConfig {
  apiUrl: string;
  model: string;
  apiKey: string | null;
}

export type FetchImpl = typeof fetch;

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
export const BATCH_SIZE = 32;
export const MAX_CHUNK_CHARS = 2000;

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * The embedding endpoint from Settings > Integrations. The URL may be left
 * blank to reuse the LLM integration's server; the model is required.
 */
export async function getEmbeddingConfig(userId: string): Promise<EmbeddingConfig | null> {
  const result = await query(
    `SELECT key, value FROM plugin_settings
      WHERE user_id = $1 AND plugin_id = 'notes'
        AND key IN ('embedding_api_url', 'embedding_model', 'embedding_api_key')`,
    [userId],
  );
  const values: Record<string, unknown> = {};
  for (const row of result.rows) values[row.key] = row.value;
  const model = typeof values.embedding_model === 'string' ? values.embedding_model.trim() : '';
  if (!model) return null;
  let apiUrl = typeof values.embedding_api_url === 'string' ? normalizeUrl(values.embedding_api_url) : '';
  if (!apiUrl) apiUrl = (await getLlmSettings(userId))?.api_url ?? '';
  if (!apiUrl) return null;
  const apiKey = typeof values.embedding_api_key === 'string' && values.embedding_api_key.trim()
    ? values.embedding_api_key.trim()
    : null;
  return { apiUrl, model, apiKey };
}

/**
 * Split a note into chunks of at most `maxChars`, on paragraph boundaries
 * where possible, then sentences, then hard cuts. The title leads the first
 * chunk.
 */
export function chunkNote(title: string | null, body: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const text = [title?.trim(), body.trim()].filter(Boolean).join('\n\n');
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const pieces: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    if (para.length <= maxChars) {
      pieces.push(para);
      continue;
    }
    for (const sentence of para.split(/(?<=[.!?])\s+/)) {
      for (let i = 0; i < sentence.length; i += maxChars) pieces.push(sentence.slice(i, i + maxChars));
    }
  }

  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + 2 + piece.length > maxChars) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function l2Normalize(vector: number[]): number[] {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  return norm > 0 ? vector.map((v) => v / norm) : vector.map(() => 0);
}

/** Mean of the (normalized) chunk vectors, normalized again. */
export function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const v of vectors) {
    const n = l2Normalize(v);
    for (let i = 0; i < dims; i++) sum[i] += n[i] ?? 0;
  }
  return l2Normalize(sum);
}

/** Embed `inputs` in batches; returns one vector per input, in order. */
export async function embedTexts(
  config: EmbeddingConfig,
  inputs: string[],
  fetchImpl: FetchImpl = fetch,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE);
    let res: Response;
    try {
      res = await fetchImpl(`${config.apiUrl}/embeddings`, {
        method: 'POST',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: config.model, input: batch }),
      });
    } catch (err) {
      throw new Error(`Could not reach the embedding endpoint at ${config.apiUrl}: ${err instanceof Error ? err.message : err}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Embedding request failed (${res.status})${text ? `: ${text.slice(0, 300)}` : ''}`);
    }
    const json = await res.json() as { data?: { index?: number; embedding?: unknown }[] };
    const data = Array.isArray(json.data) ? json.data : [];
    if (data.length !== batch.length) {
      throw new Error(`The embedding endpoint returned ${data.length} vectors for ${batch.length} inputs`);
    }
    const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const item of sorted) {
      if (!Array.isArray(item.embedding) || item.embedding.length === 0 || !item.embedding.every((v) => typeof v === 'number')) {
        throw new Error('The embedding endpoint returned a malformed vector');
      }
      out.push(item.embedding as number[]);
    }
  }
  return out;
}
