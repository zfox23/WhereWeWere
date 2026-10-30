/**
 * Notes plugin — the similarity analysis (the `notes-similarity` job).
 *
 *   1. embed     new and edited notes only (an embedding remembers the
 *                content hash and model it came from)
 *   2. link      each note's most similar notes -> note_neighbors
 *   3. cluster   all embedded notes into themes
 *   4. name      new themes with the chat LLM; a theme whose notes are mostly
 *                unchanged keeps its id, name and color
 */

import type { PluginJobProgress } from 'wwp-shared';
import { pool, query } from '../../../server/src/db';
import { getLlmSettings } from '../../../server/src/services/llmClient';
import { chunkNote, embedTexts, getEmbeddingConfig, meanPool, BATCH_SIZE, type FetchImpl } from './embeddings';
import {
  assignThemes,
  clusterNotes,
  matchPreviousThemes,
  representativeMembers,
  topKNeighbors,
  type Vector,
} from './similarity';
import { nameTheme, type ThemeSample } from './themeNaming';
import { OVERFLOW_COLOR, TAG_PALETTE } from '../manifest';

export const NEIGHBOR_K = 15;
export const NEIGHBOR_FLOOR = 0.3;
const SAMPLES_PER_THEME = 12;

/**
 * Theme colors: the validated categorical order, largest themes first;
 * themes past the eighth share a neutral gray (reused themes keep theirs).
 */
export const THEME_PALETTE: readonly string[] = TAG_PALETTE;

export interface AnalysisContext {
  isCancelled: () => boolean;
  updateProgress: (progress: PluginJobProgress) => Promise<void>;
  fetchImpl?: FetchImpl;
}

export interface AnalysisResult {
  embedded: number;
  analyzed: number;
  themes: number;
}

function checkCancelled(ctx: AnalysisContext) {
  if (ctx.isCancelled()) throw new Error('cancelled');
}

/** SQL: this user's notes whose embedding is missing or stale for `$2` (the model). */
export const PENDING_WHERE = `n.user_id = $1 AND (e.note_id IS NULL OR e.content_hash <> n.content_hash OR e.model <> $2)`;

export async function runSimilarityAnalysis(userId: string, ctx: AnalysisContext): Promise<AnalysisResult> {
  const config = await getEmbeddingConfig(userId);
  if (!config) {
    throw new Error('Set up an embedding model for notes in Settings > Integrations first.');
  }

  // ---- 1. embed ----------------------------------------------------------
  const pending = await query(
    `SELECT n.id, n.title, n.body, n.content_hash
     FROM note_checkins n LEFT JOIN note_embeddings e ON e.note_id = n.id
     WHERE ${PENDING_WHERE}
     ORDER BY n.checked_in_at ASC`,
    [userId, config.model],
  );
  const todo = pending.rows as { id: string; title: string | null; body: string; content_hash: string }[];
  let embedded = 0;
  await ctx.updateProgress({ phase: 'embedding', updated: 0, remaining: todo.length, message: `Embedding ${todo.length} notes…` });

  let i = 0;
  while (i < todo.length) {
    checkCancelled(ctx);
    // Pack whole notes into one request of up to BATCH_SIZE chunks.
    const group: { note: (typeof todo)[number]; chunks: string[] }[] = [];
    let inputs = 0;
    while (i < todo.length) {
      const chunks = chunkNote(todo[i].title, todo[i].body);
      if (group.length > 0 && inputs + chunks.length > BATCH_SIZE) break;
      group.push({ note: todo[i], chunks });
      inputs += chunks.length;
      i++;
    }
    const vectors = await embedTexts(config, group.flatMap((g) => g.chunks), ctx.fetchImpl);
    let offset = 0;
    for (const { note, chunks } of group) {
      const pooled = meanPool(vectors.slice(offset, offset + chunks.length));
      offset += chunks.length;
      await query(
        `INSERT INTO note_embeddings (note_id, model, content_hash, dims, chunk_count, embedding, embedded_at)
         VALUES ($1, $2, $3, $4, $5, $6::real[], NOW())
         ON CONFLICT (note_id) DO UPDATE SET
           model = EXCLUDED.model, content_hash = EXCLUDED.content_hash, dims = EXCLUDED.dims,
           chunk_count = EXCLUDED.chunk_count, embedding = EXCLUDED.embedding, embedded_at = NOW()`,
        [note.id, config.model, note.content_hash, pooled.length, chunks.length, pooled],
      );
      embedded++;
    }
    await ctx.updateProgress({
      phase: 'embedding',
      updated: embedded,
      remaining: todo.length - embedded,
      message: `Embedded ${embedded} of ${todo.length} notes`,
    });
  }

  // ---- 2. link -----------------------------------------------------------
  checkCancelled(ctx);
  const rows = (await query(
    `SELECT n.id, n.title, left(n.body, 1200) AS excerpt,
            (n.checked_in_at AT TIME ZONE COALESCE(n.checkin_timezone, 'UTC'))::date::text AS date,
            COALESCE((SELECT array_agg(t.name ORDER BY lower(t.name))
                      FROM note_tag_links l JOIN note_tags t ON t.id = l.tag_id
                      WHERE l.note_id = n.id), '{}') AS tags,
            e.embedding
     FROM note_checkins n JOIN note_embeddings e ON e.note_id = n.id
     WHERE n.user_id = $1 AND e.model = $2 AND e.content_hash = n.content_hash
     ORDER BY n.checked_in_at ASC`,
    [userId, config.model],
  )).rows as { id: string; title: string | null; excerpt: string; date: string; tags: string[]; embedding: number[] }[];

  // Mixed dimensions mean the model changed mid-history; keep the majority.
  const dimCounts = new Map<number, number>();
  for (const r of rows) dimCounts.set(r.embedding.length, (dimCounts.get(r.embedding.length) ?? 0) + 1);
  const dims = [...dimCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const notes = rows.filter((r) => r.embedding.length === dims);
  const vectors: Vector[] = notes.map((r) => Float32Array.from(r.embedding));

  await ctx.updateProgress({ phase: 'linking', updated: embedded, remaining: 0, message: `Finding similar notes among ${notes.length}…` });
  const neighbors = await topKNeighbors(vectors, NEIGHBOR_K, NEIGHBOR_FLOOR, async (done, total) => {
    checkCancelled(ctx);
    await ctx.updateProgress({ phase: 'linking', updated: embedded, remaining: 0, message: `Comparing notes (${done}/${total})…` });
  });

  // ---- 3. cluster --------------------------------------------------------
  checkCancelled(ctx);
  await ctx.updateProgress({ phase: 'clustering', updated: embedded, remaining: 0, message: 'Grouping notes into themes…' });
  const clustering = await clusterNotes(vectors);
  const assignments = clustering ? assignThemes(vectors, clustering) : [];

  const previousMembers = new Map<string, Set<string>>();
  const previousColors = new Map<string, string>();
  const prev = await query(
    `SELECT t.id, t.color, m.note_id
     FROM note_themes t LEFT JOIN note_theme_members m ON m.theme_id = t.id AND m.rank = 1
     WHERE t.user_id = $1`,
    [userId],
  );
  for (const r of prev.rows as { id: string; color: string; note_id: string | null }[]) {
    previousColors.set(r.id, r.color);
    if (!previousMembers.has(r.id)) previousMembers.set(r.id, new Set());
    if (r.note_id) previousMembers.get(r.id)!.add(r.note_id);
  }
  const clusterMembers: string[][] = clustering
    ? Array.from({ length: clustering.k }, (_, c) => notes.filter((_, idx) => clustering.assignments[idx] === c).map((n) => n.id))
    : [];
  const reused = matchPreviousThemes(clusterMembers, previousMembers);

  // ---- 4. name -----------------------------------------------------------
  const llm = await getLlmSettings(userId);
  const names: ({ label: string; description: string | null } | null)[] = [];
  const newCount = reused.filter((r) => !r).length;
  let named = 0;
  for (let c = 0; c < clusterMembers.length; c++) {
    checkCancelled(ctx);
    if (reused[c]) {
      names.push(null);
      continue;
    }
    await ctx.updateProgress({
      phase: 'naming',
      updated: embedded,
      remaining: 0,
      message: `Naming themes (${named + 1}/${newCount})…`,
    });
    const samples: ThemeSample[] = representativeMembers(vectors, clustering!, c, SAMPLES_PER_THEME).map((idx) => ({
      title: notes[idx].title,
      excerpt: notes[idx].excerpt,
      date: notes[idx].date,
      tags: notes[idx].tags,
    }));
    names.push(await nameTheme(llm, samples, c + 1));
    named++;
  }

  // ---- write neighbors + themes atomically --------------------------------
  checkCancelled(ctx);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM note_neighbors WHERE note_id IN (SELECT id FROM note_checkins WHERE user_id = $1)',
      [userId],
    );
    const src: string[] = [];
    const dst: string[] = [];
    const sim: number[] = [];
    neighbors.forEach((list, idx) => {
      for (const nb of list) {
        src.push(notes[idx].id);
        dst.push(notes[nb.index].id);
        sim.push(Math.round(nb.similarity * 10000) / 10000);
      }
    });
    if (src.length > 0) {
      await client.query(
        `INSERT INTO note_neighbors (note_id, neighbor_id, similarity)
         SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::real[])`,
        [src, dst, sim],
      );
    }

    const keep = reused.filter((r): r is string => Boolean(r));
    await client.query('DELETE FROM note_themes WHERE user_id = $1 AND NOT (id = ANY($2::uuid[]))', [userId, keep]);
    await client.query('DELETE FROM note_theme_members WHERE theme_id = ANY($1::uuid[])', [keep]);

    const usedColors = new Set(keep.map((id) => previousColors.get(id)));
    const freeColors = THEME_PALETTE.filter((c) => !usedColors.has(c));
    const themeIds: string[] = new Array(clusterMembers.length);
    // Largest new themes take the free palette slots first.
    const bySize = clusterMembers.map((_, c) => c).sort((a, b) => clusterMembers[b].length - clusterMembers[a].length);
    for (const c of bySize) {
      const size = clusterMembers[c].length;
      if (reused[c]) {
        await client.query('UPDATE note_themes SET size = $2 WHERE id = $1', [reused[c], size]);
        themeIds[c] = reused[c]!;
      } else {
        const color = freeColors.shift() ?? OVERFLOW_COLOR;
        const inserted = await client.query(
          `INSERT INTO note_themes (user_id, label, description, color, size) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [userId, names[c]!.label, names[c]!.description, color, size],
        );
        themeIds[c] = inserted.rows[0].id as string;
      }
    }

    const mNote: string[] = [];
    const mTheme: string[] = [];
    const mRank: number[] = [];
    const mScore: number[] = [];
    assignments.forEach((a, idx) => {
      mNote.push(notes[idx].id);
      mTheme.push(themeIds[a.primary.cluster]);
      mRank.push(1);
      mScore.push(Math.round(a.primary.score * 10000) / 10000);
      if (a.secondary) {
        mNote.push(notes[idx].id);
        mTheme.push(themeIds[a.secondary.cluster]);
        mRank.push(2);
        mScore.push(Math.round(a.secondary.score * 10000) / 10000);
      }
    });
    if (mNote.length > 0) {
      await client.query(
        `INSERT INTO note_theme_members (note_id, theme_id, rank, score)
         SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::smallint[], $4::real[])`,
        [mNote, mTheme, mRank, mScore],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = { embedded, analyzed: notes.length, themes: clusterMembers.length };
  await ctx.updateProgress({
    phase: 'done',
    updated: embedded,
    remaining: 0,
    message: `Analyzed ${result.analyzed} notes into ${result.themes} themes (${embedded} newly embedded).`,
  });
  return result;
}
