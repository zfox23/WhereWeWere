/**
 * Notes check-in type — server half.
 *
 * CUSTOM storage (`note_checkins` + `note_tags` / `note_tag_links`, plus the
 * similarity tables; migration 072): notes carry colored tags, companions
 * (shared core table) and derived similarity data, none of which the generic
 * store has hooks for.
 *
 * Mounted at /api/v1/notes:
 *   GET/POST        /checkins              list / create
 *   GET/PUT/DELETE  /checkins/:id
 *   GET             /checkins/:id/related  most similar notes (after analysis)
 *   GET/POST        /tags                  list (with counts) / create
 *   PUT/DELETE      /tags/:id              rename + recolor (409 on a name clash) / delete
 *   POST            /tags/:id/merge        move a tag's notes to another tag, drop it
 *   GET             /library               light rows for the Note Library trees
 *   GET             /graph                 nodes + similarity edges for the Similarity Web
 *   GET             /stats                 Profile > Notes (?from=&to=)
 *   GET             /analysis/status       embedding setup + how many notes need analysis
 * Mounted at /api/v1/import/notes:
 *   POST            /preview               plan an upload of .md/.markdown/.txt files
 *   POST            /                      import the selected files
 *
 * The similarity analysis runs as the `notes-similarity` background job.
 */

import fs from 'fs';
import { Router, Request, Response, NextFunction } from 'express';
import type {
  CheckinTypeServerPlugin,
  PluginLlmRow,
  PluginReconciliationRow,
  PluginTimelineContext,
} from 'wwp-shared';
import { isValidTimeZone } from 'wwp-shared';
import { query, pool } from '../../server/src/db';
import { isUuid } from '../../server/src/services/batching';
import { escapeLike } from '../../server/src/services/queryParams';
import { timelineColumnList } from '../../server/src/plugins/timeline';
import { timelineWhereConditions } from '../../server/src/plugins/sql';
import { createImportUpload, removeImportFile } from '../../server/src/plugins/uploads';
import { currentUserId, preserveUserContext } from '../../server/src/auth/context';
import { loadTimezoneAnchors } from '../../server/src/services/timezoneAnchors';
import { getLlmSettings } from '../../server/src/services/llmClient';
import {
  companionNamesSql,
  deleteCompanionsForCheckins,
  getCompanions,
  getCompanionsByCheckin,
  insertCompanions,
  setCompanions,
} from '../../server/src/services/companions';
import { HEX_COLOR_RE, MAX_TAG_LENGTH } from './manifest';
import {
  InputError,
  NOTE_SELECT,
  NOTE_STORED_COLUMNS,
  addTagsToNotes,
  db,
  loadNote,
  normalizeTagNames,
  parseNoteInput,
  resolveTags,
  setNoteTags,
  tagsJsonSql,
  type NoteRow,
} from './services/notesRepo';
import {
  IMPORT_EXTENSIONS,
  bodyHash,
  decodeText,
  existingKey,
  markDuplicates,
  parseImportMeta,
  planImportRow,
  type PlannedNote,
} from './services/importNotes';
import { getEmbeddingConfig } from './services/embeddings';
import { MOOD_STALE, MOOD_WITH_TEXT, PENDING_WHERE, includesMoodEntries, runSimilarityAnalysis } from './services/analysis';

export const SIMILARITY_JOB = 'notes-similarity';

/** Timeline cards render at most this much of a note; the detail page has the rest. */
const TIMELINE_BODY_CHARS = 6000;

const router = Router();
const importRouter = Router();

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function sendError(res: Response, err: unknown, fallback: string) {
  if (err instanceof InputError) return res.status(400).json({ error: err.message });
  console.error(`${fallback}:`, err);
  return res.status(500).json({ error: fallback });
}

/** `(n.checked_in_at AT TIME ZONE ...)`: the note's wall-clock time. */
const LOCAL_TS = `(n.checked_in_at AT TIME ZONE COALESCE(n.checkin_timezone, 'UTC'))`;
const MOOD_LOCAL_TS = `(mc.checked_in_at AT TIME ZONE COALESCE(mc.mood_timezone, 'UTC'))`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `AND` conditions for an optional ?from=&to= local-date range on alias `n`. */
function dateRange(req: Request, params: unknown[]): string {
  let sql = '';
  const from = typeof req.query.from === 'string' && DATE_RE.test(req.query.from) ? req.query.from : null;
  const to = typeof req.query.to === 'string' && DATE_RE.test(req.query.to) ? req.query.to : null;
  if (from) {
    params.push(from);
    sql += ` AND ${LOCAL_TS}::date >= $${params.length}::date`;
  }
  if (to) {
    params.push(to);
    sql += ` AND ${LOCAL_TS}::date <= $${params.length}::date`;
  }
  return sql;
}

// ---------------------------------------------------------------------------
// Check-in CRUD
// ---------------------------------------------------------------------------

async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function noteThemes(noteId: string) {
  const result = await query(
    `SELECT t.id, t.label, t.color, m.rank
     FROM note_theme_members m JOIN note_themes t ON t.id = m.theme_id
     WHERE m.note_id = $1 ORDER BY m.rank`,
    [noteId],
  );
  return result.rows;
}

router.get('/checkins', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const result = await query(
      `SELECT ${NOTE_SELECT} FROM note_checkins n WHERE n.user_id = $1
       ORDER BY n.checked_in_at DESC LIMIT $2 OFFSET $3`,
      [currentUserId(), limit, offset],
    );
    const companions = await getCompanionsByCheckin('notes', result.rows.map((r) => r.id as string));
    res.json(result.rows.map((r) => ({ ...r, companions: companions.get(r.id) ?? [] })));
  } catch (err) {
    sendError(res, err, 'Failed to list notes');
  }
});

router.get('/checkins/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: 'Note not found' });
  try {
    const row = await loadNote(currentUserId(), id);
    if (!row) return res.status(404).json({ error: 'Note not found' });
    const [companions, themes] = await Promise.all([getCompanions('notes', id), noteThemes(id)]);
    res.json({ ...row, companions, themes });
  } catch (err) {
    sendError(res, err, 'Failed to get note');
  }
});

router.post('/checkins', async (req: Request, res: Response) => {
  try {
    const input = parseNoteInput(req.body ?? {});
    const out = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO note_checkins (user_id, title, body, checked_in_at, checkin_timezone)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [currentUserId(), input.title, input.body, input.checked_in_at, input.checkin_timezone],
      );
      const id = result.rows[0].id as string;
      await setNoteTags(client, id, await resolveTags(client, currentUserId(), input.tags));
      await insertCompanions('notes', id, req.body?.companions, client);
      return { row: (await loadNote(currentUserId(), id, client))!, companions: await getCompanions('notes', id, client) };
    });
    res.status(201).json({ ...out.row, companions: out.companions, themes: [] });
  } catch (err) {
    sendError(res, err, 'Failed to create note');
  }
});

router.put('/checkins/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: 'Note not found' });
  try {
    const input = parseNoteInput(req.body ?? {});
    const out = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE note_checkins SET title = $3, body = $4, checked_in_at = $5, checkin_timezone = $6
         WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, currentUserId(), input.title, input.body, input.checked_in_at, input.checkin_timezone],
      );
      if (result.rowCount === 0) return null;
      await setNoteTags(client, id, await resolveTags(client, currentUserId(), input.tags));
      const companions = await setCompanions('notes', id, req.body?.companions, client);
      return { row: (await loadNote(currentUserId(), id, client))!, companions };
    });
    if (!out) return res.status(404).json({ error: 'Note not found' });
    res.json({ ...out.row, companions: out.companions, themes: await noteThemes(id) });
  } catch (err) {
    sendError(res, err, 'Failed to update note');
  }
});

router.delete('/checkins/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: 'Note not found' });
  try {
    const deleted = await withTransaction(async (client) => {
      const result = await client.query('DELETE FROM note_checkins WHERE id = $1 AND user_id = $2', [id, currentUserId()]);
      if ((result.rowCount ?? 0) === 0) return false;
      await deleteCompanionsForCheckins('notes', [id], client);
      return true;
    });
    if (!deleted) return res.status(404).json({ error: 'Note not found' });
    res.json({ message: 'Note deleted', id });
  } catch (err) {
    sendError(res, err, 'Failed to delete note');
  }
});

router.get('/checkins/:id/related', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: 'Note not found' });
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '6'), 10) || 6, 1), 15);
    if (!(await loadNote(currentUserId(), id))) return res.status(404).json({ error: 'Note not found' });
    const [related, analyzed] = await Promise.all([
      query(
        `SELECT * FROM (
           SELECT n.id, n.title, left(n.body, 300) AS excerpt, n.checked_in_at, n.checkin_timezone,
                  nb.similarity, ${tagsJsonSql('n.id')} AS tags, 'note' AS kind
           FROM note_neighbors nb JOIN note_checkins n ON n.id = nb.neighbor_id
           WHERE nb.note_id = $1 AND n.user_id = $2
           UNION ALL
           SELECT mc.id, NULL AS title, left(mc.note, 300) AS excerpt, mc.checked_in_at, mc.mood_timezone AS checkin_timezone,
                  nb.similarity, '[]'::json AS tags, 'mood' AS kind
           FROM note_mood_neighbors nb JOIN mood_checkins mc ON mc.id = nb.neighbor_id
           WHERE nb.entry_id = $1 AND nb.user_id = $2 AND mc.user_id = $2
         ) r ORDER BY similarity DESC LIMIT $3`,
        [id, currentUserId(), limit],
      ),
      query('SELECT 1 FROM note_embeddings WHERE note_id = $1', [id]),
    ]);
    res.json({ analyzed: (analyzed.rowCount ?? 0) > 0, related: related.rows });
  } catch (err) {
    sendError(res, err, 'Failed to load related notes');
  }
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function parseTagName(value: unknown): string {
  const [name] = normalizeTagNames([value ?? '']);
  if (!name) throw new InputError('Give the tag a name');
  if (name.length > MAX_TAG_LENGTH) throw new InputError(`Tag names are limited to ${MAX_TAG_LENGTH} characters`);
  return name;
}

function parseColor(value: unknown): string {
  if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) throw new InputError('color must be a #rrggbb hex color');
  return value.toLowerCase();
}

const TAG_LIST_SQL = `
  SELECT t.id, t.name, t.color, t.created_at,
         COUNT(n.id)::int AS note_count,
         COALESCE(SUM(n.word_count), 0)::int AS word_count,
         MAX(n.checked_in_at) AS last_used_at
  FROM note_tags t
  LEFT JOIN note_tag_links l ON l.tag_id = t.id
  LEFT JOIN note_checkins n ON n.id = l.note_id
  WHERE t.user_id = $1
  GROUP BY t.id
  ORDER BY lower(t.name)`;

router.get('/tags', async (_req: Request, res: Response) => {
  try {
    res.json((await query(TAG_LIST_SQL, [currentUserId()])).rows);
  } catch (err) {
    sendError(res, err, 'Failed to list tags');
  }
});

router.post('/tags', async (req: Request, res: Response) => {
  try {
    const name = parseTagName(req.body?.name);
    const [id] = await resolveTags(db, currentUserId(), [name]);
    if (req.body?.color != null) {
      await query('UPDATE note_tags SET color = $3 WHERE id = $1 AND user_id = $2', [id, currentUserId(), parseColor(req.body.color)]);
    }
    const tag = await query('SELECT id, name, color FROM note_tags WHERE id = $1 AND user_id = $2', [id, currentUserId()]);
    res.status(201).json(tag.rows[0]);
  } catch (err) {
    sendError(res, err, 'Failed to create tag');
  }
});

router.put('/tags/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: 'Tag not found' });
  try {
    const sets: string[] = [];
    const params: unknown[] = [id, currentUserId()];
    if (req.body?.name != null) {
      const name = parseTagName(req.body.name);
      const clash = await query(
        'SELECT id, name FROM note_tags WHERE user_id = $1 AND lower(name) = lower($2) AND id <> $3',
        [currentUserId(), name, id],
      );
      if (clash.rows[0]) {
        return res.status(409).json({
          error: `A tag named “${clash.rows[0].name}” already exists. Merge into it instead?`,
          conflict_id: clash.rows[0].id,
          conflict_name: clash.rows[0].name,
        });
      }
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (req.body?.color != null) {
      params.push(parseColor(req.body.color));
      sets.push(`color = $${params.length}`);
    }
    if (sets.length === 0) throw new InputError('Nothing to update');
    const result = await query(
      `UPDATE note_tags SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING id, name, color`,
      params,
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Tag not found' });
    res.json(result.rows[0]);
  } catch (err) {
    sendError(res, err, 'Failed to update tag');
  }
});

router.post('/tags/:id/merge', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const into = req.body?.into_id;
  if (!isUuid(id)) return res.status(404).json({ error: 'Tag not found' });
  if (!isUuid(into) || into === id) return res.status(400).json({ error: 'into_id must be another tag' });
  try {
    const moved = await withTransaction(async (client) => {
      const both = await client.query('SELECT id FROM note_tags WHERE user_id = $1 AND id = ANY($2::uuid[])', [currentUserId(), [id, into]]);
      if (both.rowCount !== 2) return null;
      const inserted = await client.query(
        `INSERT INTO note_tag_links (note_id, tag_id)
         SELECT note_id, $2 FROM note_tag_links WHERE tag_id = $1
         ON CONFLICT DO NOTHING`,
        [id, into],
      );
      await client.query('DELETE FROM note_tags WHERE id = $1 AND user_id = $2', [id, currentUserId()]);
      return inserted.rowCount ?? 0;
    });
    if (moved == null) return res.status(404).json({ error: 'Tag not found' });
    res.json({ merged: true, notes_moved: moved });
  } catch (err) {
    sendError(res, err, 'Failed to merge tags');
  }
});

router.delete('/tags/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!isUuid(id)) return res.status(404).json({ error: 'Tag not found' });
  try {
    const result = await query(
      `WITH counted AS (SELECT COUNT(*)::int AS n FROM note_tag_links WHERE tag_id = $1)
       DELETE FROM note_tags WHERE id = $1 AND user_id = $2 RETURNING (SELECT n FROM counted) AS untagged`,
      [id, currentUserId()],
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Tag not found' });
    res.json({ deleted: true, notes_untagged: result.rows[0].untagged });
  } catch (err) {
    sendError(res, err, 'Failed to delete tag');
  }
});

// ---------------------------------------------------------------------------
// Library + Similarity Web
// ---------------------------------------------------------------------------

async function loadThemes() {
  const result = await query(
    'SELECT id, label, description, color, size FROM note_themes WHERE user_id = $1 ORDER BY size DESC, label',
    [currentUserId()],
  );
  return result.rows;
}

const LIBRARY_ROW_SQL = `
  SELECT n.id, n.title, left(n.body, 200) AS excerpt, n.checked_in_at, n.checkin_timezone,
         ${LOCAL_TS}::date::text AS local_date, n.word_count,
         COALESCE((SELECT array_agg(l.tag_id) FROM note_tag_links l WHERE l.note_id = n.id), '{}') AS tag_ids,
         (SELECT m.theme_id FROM note_theme_members m WHERE m.note_id = n.id AND m.rank = 1) AS theme_id
  FROM note_checkins n
  WHERE n.user_id = $1
  ORDER BY n.checked_in_at DESC`;

router.get('/library', async (_req: Request, res: Response) => {
  try {
    const [notes, tags, themes] = await Promise.all([
      query(LIBRARY_ROW_SQL, [currentUserId()]),
      query('SELECT id, name, color FROM note_tags WHERE user_id = $1 ORDER BY lower(name)', [currentUserId()]),
      loadThemes(),
    ]);
    res.json({ notes: notes.rows, tags: tags.rows, themes });
  } catch (err) {
    sendError(res, err, 'Failed to load the note library');
  }
});

router.get('/graph', async (_req: Request, res: Response) => {
  try {
    const [notes, moods, edges, moodEdges, tags, themes] = await Promise.all([
      query(
        `SELECT n.id, n.title, left(n.body, 120) AS excerpt, ${LOCAL_TS}::date::text AS local_date, n.word_count,
                COALESCE((SELECT array_agg(l.tag_id) FROM note_tag_links l WHERE l.note_id = n.id), '{}') AS tag_ids,
                (SELECT m.theme_id FROM note_theme_members m WHERE m.note_id = n.id AND m.rank = 1) AS theme_id,
                'note' AS kind
         FROM note_checkins n JOIN note_embeddings e ON e.note_id = n.id
         WHERE n.user_id = $1`,
        [currentUserId()],
      ),
      // Mood entries are in the web only while they hold a theme (the setting is on).
      query(
        `SELECT mc.id, NULL AS title, left(mc.note, 120) AS excerpt, ${MOOD_LOCAL_TS}::date::text AS local_date,
                COALESCE(array_length(regexp_split_to_array(btrim(mc.note), '\\s+'), 1), 0) AS word_count,
                '{}'::uuid[] AS tag_ids, m.theme_id, 'mood' AS kind
         FROM mood_checkins mc JOIN note_theme_mood_members m ON m.mood_checkin_id = mc.id AND m.rank = 1
         WHERE mc.user_id = $1`,
        [currentUserId()],
      ),
      // Each pair once: the neighbor lists are symmetric-ish (top-k per note).
      query(
        `SELECT DISTINCT LEAST(nb.note_id, nb.neighbor_id) AS source,
                GREATEST(nb.note_id, nb.neighbor_id) AS target, nb.similarity
         FROM note_neighbors nb JOIN note_checkins n ON n.id = nb.note_id
         WHERE n.user_id = $1`,
        [currentUserId()],
      ),
      query(
        `SELECT DISTINCT LEAST(entry_id, neighbor_id) AS source, GREATEST(entry_id, neighbor_id) AS target, similarity
         FROM note_mood_neighbors WHERE user_id = $1`,
        [currentUserId()],
      ),
      query('SELECT id, name, color FROM note_tags WHERE user_id = $1 ORDER BY lower(name)', [currentUserId()]),
      loadThemes(),
    ]);
    const nodes = [...notes.rows, ...moods.rows];
    const ids = new Set(nodes.map((n) => n.id as string));
    // Neighbor rows can outlive an entry (deleted, or edited out of the analysis).
    const mixed = moodEdges.rows.filter((e) => ids.has(e.source as string) && ids.has(e.target as string));
    res.json({ nodes, edges: [...edges.rows, ...mixed], tags: tags.rows, themes });
  } catch (err) {
    sendError(res, err, 'Failed to load the similarity web');
  }
});

// ---------------------------------------------------------------------------
// Stats (Profile > Notes)
// ---------------------------------------------------------------------------

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const params: unknown[] = [currentUserId()];
    const range = dateRange(req, params);
    // The same range on the mood table's alias and local-time expression.
    const moodRange = range.split(LOCAL_TS).join(MOOD_LOCAL_TS);
    const base = `FROM note_checkins n WHERE n.user_id = $1${range}`;
    const [totals, byTag, tagMonths, rhythm, themes, themeYears, themeTags] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS notes,
                COALESCE(SUM(n.word_count), 0)::int AS words,
                COALESCE(ROUND(AVG(n.word_count)), 0)::int AS avg_words,
                COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM note_tag_links l WHERE l.note_id = n.id))::int AS untagged,
                COUNT(DISTINCT ${LOCAL_TS}::date)::int AS days_written,
                MAX(n.word_count)::int AS longest_words
         ${base}`,
        params,
      ),
      query(
        `SELECT t.id, t.name, t.color, COUNT(*)::int AS notes,
                SUM(n.word_count)::int AS words, ROUND(AVG(n.word_count))::int AS avg_words,
                MIN(n.checked_in_at) AS first_at, MAX(n.checked_in_at) AS last_at
         FROM note_checkins n
         JOIN note_tag_links l ON l.note_id = n.id JOIN note_tags t ON t.id = l.tag_id
         WHERE n.user_id = $1${range}
         GROUP BY t.id ORDER BY notes DESC, lower(t.name)`,
        params,
      ),
      query(
        `SELECT to_char(${LOCAL_TS}, 'YYYY-MM') AS month, l.tag_id, COUNT(*)::int AS notes
         FROM note_checkins n LEFT JOIN note_tag_links l ON l.note_id = n.id
         WHERE n.user_id = $1${range}
         GROUP BY 1, 2 ORDER BY 1`,
        params,
      ),
      query(
        `SELECT EXTRACT(ISODOW FROM ${LOCAL_TS})::int AS dow, EXTRACT(HOUR FROM ${LOCAL_TS})::int AS hour,
                COUNT(*)::int AS notes
         ${base} GROUP BY 1, 2`,
        params,
      ),
      query(
        `SELECT t.id, t.label, t.description, t.color, COUNT(*)::int AS notes
         FROM (
           SELECT m.theme_id FROM note_checkins n
           JOIN note_theme_members m ON m.note_id = n.id AND m.rank = 1
           WHERE n.user_id = $1${range}
           UNION ALL
           SELECT m.theme_id FROM mood_checkins mc
           JOIN note_theme_mood_members m ON m.mood_checkin_id = mc.id AND m.rank = 1
           WHERE mc.user_id = $1${moodRange}
         ) x JOIN note_themes t ON t.id = x.theme_id
         GROUP BY t.id ORDER BY notes DESC`,
        params,
      ),
      query(
        `SELECT year, theme_id, COUNT(*)::int AS notes FROM (
           SELECT EXTRACT(YEAR FROM ${LOCAL_TS})::int AS year, m.theme_id
           FROM note_checkins n JOIN note_theme_members m ON m.note_id = n.id AND m.rank = 1
           WHERE n.user_id = $1${range}
           UNION ALL
           SELECT EXTRACT(YEAR FROM ${MOOD_LOCAL_TS})::int, m.theme_id
           FROM mood_checkins mc JOIN note_theme_mood_members m ON m.mood_checkin_id = mc.id AND m.rank = 1
           WHERE mc.user_id = $1${moodRange}
         ) x GROUP BY 1, 2 ORDER BY 1`,
        params,
      ),
      query(
        `SELECT m.theme_id, l.tag_id, COUNT(*)::int AS notes
         FROM note_checkins n
         JOIN note_theme_members m ON m.note_id = n.id AND m.rank = 1
         JOIN note_tag_links l ON l.note_id = n.id
         WHERE n.user_id = $1${range}
         GROUP BY 1, 2`,
        params,
      ),
    ]);
    res.json({
      totals: totals.rows[0],
      by_tag: byTag.rows,
      tag_months: tagMonths.rows,
      rhythm: rhythm.rows,
      themes: themes.rows,
      theme_years: themeYears.rows,
      theme_tags: themeTags.rows,
    });
  } catch (err) {
    sendError(res, err, 'Failed to load note stats');
  }
});

// ---------------------------------------------------------------------------
// Similarity analysis status
// ---------------------------------------------------------------------------

router.get('/analysis/status', async (_req: Request, res: Response) => {
  try {
    const userId = currentUserId();
    const [config, llm] = await Promise.all([getEmbeddingConfig(userId), getLlmSettings(userId)]);
    const includeMood = await includesMoodEntries(userId);
    const [counts, moodCounts, themes, lastRun, active] = await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ${PENDING_WHERE.replace('n.user_id = $1 AND ', '')})::int AS pending
         FROM note_checkins n LEFT JOIN note_embeddings e ON e.note_id = n.id
         WHERE n.user_id = $1`,
        [userId, config?.model ?? ''],
      ),
      includeMood
        ? query(
          `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ${MOOD_STALE})::int AS pending
           FROM mood_checkins mc LEFT JOIN note_mood_embeddings e ON e.mood_checkin_id = mc.id
           WHERE ${MOOD_WITH_TEXT}`,
          [userId, config?.model ?? ''],
        )
        : Promise.resolve(null),
      query('SELECT COUNT(*)::int AS n FROM note_themes WHERE user_id = $1', [userId]),
      query(
        `SELECT completed_at FROM jobs WHERE type = $1 AND user_id = $2 AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`,
        [SIMILARITY_JOB, userId],
      ),
      query(
        `SELECT id FROM jobs WHERE type = $1 AND user_id = $2 AND status IN ('pending', 'running') ORDER BY created_at DESC LIMIT 1`,
        [SIMILARITY_JOB, userId],
      ),
    ]);
    const noteCounts = counts.rows[0] as { total: number; pending: number };
    const mood = (moodCounts?.rows[0] ?? { total: 0, pending: 0 }) as { total: number; pending: number };
    const total = noteCounts.total + mood.total;
    const pending = noteCounts.pending + mood.pending;
    res.json({
      include_mood_entries: includeMood,
      mood_total: mood.total,
      embeddings_configured: Boolean(config),
      embedding_model: config?.model ?? null,
      llm_configured: Boolean(llm),
      total,
      pending,
      analyzed: total - pending,
      themes: themes.rows[0].n,
      last_run_at: lastRun.rows[0]?.completed_at ?? null,
      active_job_id: active.rows[0]?.id ?? null,
    });
  } catch (err) {
    sendError(res, err, 'Failed to load the analysis status');
  }
});

// ---------------------------------------------------------------------------
// File import: stateless preview -> confirm (the files are uploaded twice)
// ---------------------------------------------------------------------------

export const MAX_IMPORT_FILES = 2000;

const notesUpload = createImportUpload({
  fileFilter: (file) => (IMPORT_EXTENSIONS.test(file.originalname) ? null : `${file.originalname} is not a .md, .markdown or .txt file`),
  fileSize: 5 * 1024 * 1024,
});

function uploadedFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

async function existingNoteKeys() {
  const result = await query(
    `SELECT ${LOCAL_TS}::date::text AS date, n.title, md5(n.body) AS hash
     FROM note_checkins n WHERE n.user_id = $1`,
    [currentUserId()],
  );
  const dateTitles = new Set<string>();
  const bodyHashes = new Set<string>();
  for (const r of result.rows as { date: string; title: string | null; hash: string }[]) {
    const key = existingKey(r.date, r.title);
    if (key) dateTitles.add(key);
    bodyHashes.add(r.hash);
  }
  return { dateTitles, bodyHashes };
}

/** Plan every uploaded file (titles, instants, zones, duplicate flags). */
async function planUpload(req: Request): Promise<PlannedNote[]> {
  const files = uploadedFiles(req);
  const metas = parseImportMeta(req.body?.meta, files.length, files.map((f) => f.originalname));
  const fallback = typeof req.body?.fallback_timezone === 'string' && isValidTimeZone(req.body.fallback_timezone)
    ? req.body.fallback_timezone
    : 'UTC';
  const [anchors, existing] = await Promise.all([loadTimezoneAnchors(currentUserId()), existingNoteKeys()]);
  const rows = files.map((file, index) => planImportRow({
    index,
    meta: metas[index],
    text: decodeText(fs.readFileSync(file.path)),
    anchors,
    fallbackTimezone: fallback,
  }));
  return markDuplicates(rows, existing);
}

function previewRow(row: PlannedNote) {
  const { body: _body, ...rest } = row;
  return { ...rest, word_count: row.body.trim() ? row.body.trim().split(/\s+/).length : 0 };
}

importRouter.post('/preview', preserveUserContext(notesUpload.array('files', MAX_IMPORT_FILES)), async (req: Request, res: Response) => {
  const files = uploadedFiles(req);
  try {
    if (files.length === 0) return res.status(400).json({ error: 'No files provided' });
    const rows = await planUpload(req);
    res.json({
      total: rows.length,
      selected: rows.filter((r) => r.selected_default).length,
      fallback_count: rows.filter((r) => r.tz_source === 'fallback').length,
      duplicate_count: rows.filter((r) => r.duplicate).length,
      rows: rows.map(previewRow),
    });
  } catch (err) {
    sendError(res, err, 'Failed to preview the import');
  } finally {
    for (const f of files) removeImportFile(f.path);
  }
});

importRouter.post('/', preserveUserContext(notesUpload.array('files', MAX_IMPORT_FILES)), async (req: Request, res: Response) => {
  const files = uploadedFiles(req);
  try {
    if (files.length === 0) return res.status(400).json({ error: 'No files provided' });
    let selected: Set<number> | null = null;
    if (typeof req.body?.selected === 'string' && req.body.selected) {
      try {
        const parsed = JSON.parse(req.body.selected);
        if (!Array.isArray(parsed)) throw new Error();
        selected = new Set(parsed.map(Number).filter(Number.isInteger));
      } catch {
        return res.status(400).json({ error: 'selected must be a JSON array of file indexes' });
      }
    }
    let tagNames: string[] = [];
    if (typeof req.body?.tags === 'string' && req.body.tags) {
      try {
        tagNames = normalizeTagNames(JSON.parse(req.body.tags));
      } catch (err) {
        if (err instanceof InputError) throw err;
        return res.status(400).json({ error: 'tags must be a JSON array of names' });
      }
    }

    const rows = await planUpload(req);
    const chosen = rows.filter((r) => (selected ? selected.has(r.index) : r.selected_default));
    const errors: string[] = [];
    const importable = chosen.filter((r) => {
      if (r.error) errors.push(`${r.filename}: ${r.error}`);
      return !r.error;
    });

    const ids = await withTransaction(async (client) => {
      const inserted: string[] = [];
      for (const r of importable) {
        const result = await client.query(
          `INSERT INTO note_checkins (user_id, title, body, checked_in_at, checkin_timezone, source, source_filename)
           VALUES ($1, $2, $3, $4, $5, 'import', $6) RETURNING id`,
          [currentUserId(), r.title, r.body, r.checked_in_at, r.timezone, r.filename.slice(0, 500)],
        );
        inserted.push(result.rows[0].id as string);
      }
      await addTagsToNotes(client, inserted, await resolveTags(client, currentUserId(), tagNames));
      return inserted;
    });

    res.json({
      imported: ids.length,
      skipped: rows.length - ids.length,
      imported_ids: ids,
      errors: errors.slice(0, 20),
      total_errors: errors.length,
    });
  } catch (err) {
    sendError(res, err, 'Import failed');
  } finally {
    for (const f of files) removeImportFile(f.path);
  }
});

// Surface multer/file-filter rejections (e.g. a .docx upload) as 400s.
importRouter.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, next: NextFunction) => {
  if (err?.status && err.status >= 400 && err.status < 500) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'A file is larger than 5 MB' });
    return;
  }
  if (err?.code === 'LIMIT_UNEXPECTED_FILE' || err?.code === 'LIMIT_FILE_COUNT') {
    res.status(400).json({ error: `Upload at most ${MAX_IMPORT_FILES} files at a time` });
    return;
  }
  next(err);
});

// ---------------------------------------------------------------------------
// LLM life summary line formatting
// ---------------------------------------------------------------------------

function formatLlmWhen(iso: string | Date, timezone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return new Intl.DateTimeFormat('en-US', timezone ? { ...opts, timeZone: timezone } : opts).format(new Date(iso));
}

const LLM_EXCERPT_CHARS = 600;

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

const NOTE_INSERT_SQL = `
  INSERT INTO note_checkins (${NOTE_STORED_COLUMNS})
  VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8,
          COALESCE($9::timestamptz, NOW()), COALESCE($10::timestamptz, NOW()))
  ON CONFLICT (id) DO NOTHING`;

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const server: CheckinTypeServerPlugin = {
  storage: 'custom',

  api: [
    { mount: '/notes', router },
    { mount: '/import/notes', router: importRouter },
  ],

  buildTimelineSelect: () => ({
    sql: `
      SELECT ${timelineColumnList({
        type: `'notes'`,
        id: 'n.id',
        user_id: 'n.user_id',
        notes: `left(n.body, ${TIMELINE_BODY_CHARS})`,
        checked_in_at: 'n.checked_in_at',
        created_at: 'n.created_at',
        companions: `(${companionNamesSql('notes', 'n.id')})`,
        data: `jsonb_build_object(
          'title', n.title,
          'tags', ${tagsJsonSql('n.id')},
          'word_count', n.word_count,
          'truncated', length(n.body) > ${TIMELINE_BODY_CHARS}
        )`,
        timezone: 'n.checkin_timezone',
      })}
      FROM note_checkins n
    `,
  }),

  buildTimelineWhere: (ctx: PluginTimelineContext) => {
    const conds = timelineWhereConditions(ctx, {
      alias: 'n',
      timestampColumn: 'checked_in_at',
      timezoneColumn: 'checkin_timezone',
      // Full-text over title + body (stemmed), plus substring matches on the
      // title and tag names so partial words still find a note.
      search: (c, q) => {
        const like = `%${escapeLike(q)}%`;
        c.push(
          `(n.search_vector @@ plainto_tsquery('english', ?)
            OR n.title ILIKE ?
            OR EXISTS (SELECT 1 FROM note_tag_links sl JOIN note_tags st ON st.id = sl.tag_id
                       WHERE sl.note_id = n.id AND st.name ILIKE ?))`,
          q, like, like,
        );
      },
    });
    if (ctx.filterParams.note_tag) {
      const names = ctx.filterParams.note_tag.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (names.length > 0) {
        conds.push(
          `EXISTS (SELECT 1 FROM note_tag_links fl JOIN note_tags ft ON ft.id = fl.tag_id
                   WHERE fl.note_id = n.id AND lower(ft.name) = ANY(?::text[]))`,
          names,
        );
      }
    }
    return conds.build();
  },

  // Companion rows are core-owned and ship in the backup's companions.json.
  // Tags, links and the similarity data ride along as extra tables.
  backupExport: async ({ user_id, client }) => {
    const result = await (client ?? db).query(
      `SELECT ${NOTE_STORED_COLUMNS} FROM note_checkins WHERE user_id = $1 ORDER BY checked_in_at ASC`,
      [user_id],
    );
    return result.rows;
  },

  backupImport: async ({ user_id, client: txClient, errors }, payload) => {
    const ownsClient = txClient == null;
    const client = txClient ?? (await pool.connect());
    let inserted = 0;
    try {
      for (const row of asRecordArray(payload)) {
        const title = typeof row.title === 'string' && row.title.trim() ? row.title : null;
        const body = typeof row.body === 'string' ? row.body : '';
        const at = row.checked_in_at ? new Date(String(row.checked_in_at)) : null;
        if (!isUuid(row.id) || (!title && !/\S/.test(body)) || !at || Number.isNaN(at.getTime())) {
          errors?.push(`Skipped a note with missing or invalid fields (${String(row.id ?? 'no id')}).`);
          continue;
        }
        const result = await client.query(NOTE_INSERT_SQL, [
          row.id, user_id, title, body, at.toISOString(),
          typeof row.checkin_timezone === 'string' && isValidTimeZone(row.checkin_timezone) ? row.checkin_timezone : null,
          row.source === 'import' ? 'import' : 'manual',
          typeof row.source_filename === 'string' ? row.source_filename : null,
          row.created_at ?? null,
          row.updated_at ?? null,
        ]);
        if ((result.rowCount ?? 0) > 0) inserted++;
      }
    } finally {
      if (ownsClient) client.release();
    }
    return inserted;
  },

  // Restore runs in one transaction, so every insert below is guarded: a row
  // whose note/tag/theme didn't restore (or a tag name already taken by a
  // different id) is skipped rather than aborting the whole restore. Each
  // takes the restoring user first and only attaches to that user's notes
  // and themes, whatever ids the backup names.
  extraBackupTables: [
    {
      table: 'noteTags',
      select: `SELECT id, name, color, created_at, updated_at
               FROM note_tags WHERE user_id = $1 ORDER BY lower(name)`,
      insert: `INSERT INTO note_tags (user_id, id, name, color, created_at, updated_at)
               VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()))
               ON CONFLICT DO NOTHING`,
      userIdFirst: true,
    },
    {
      // Links carry the tag *name*: restoring over an existing library maps
      // onto the tag of that name even when its id differs.
      table: 'noteTagLinks',
      select: `SELECT l.note_id, t.name AS tag_name
               FROM note_tag_links l
               JOIN note_tags t ON t.id = l.tag_id
               JOIN note_checkins n ON n.id = l.note_id
               WHERE n.user_id = $1`,
      insert: `INSERT INTO note_tag_links (note_id, tag_id)
               SELECT n.id, t.id FROM note_checkins n
               JOIN note_tags t ON t.user_id = n.user_id AND lower(t.name) = lower($3)
               WHERE n.id = $2 AND n.user_id = $1
               ON CONFLICT DO NOTHING`,
      userIdFirst: true,
    },
    {
      table: 'noteEmbeddings',
      select: `SELECT e.note_id, e.model, e.content_hash, e.dims, e.chunk_count, e.embedding, e.embedded_at
               FROM note_embeddings e JOIN note_checkins n ON n.id = e.note_id
               WHERE n.user_id = $1`,
      insert: `INSERT INTO note_embeddings (note_id, model, content_hash, dims, chunk_count, embedding, embedded_at)
               SELECT $2::uuid, $3, $4, $5, $6, $7::real[], COALESCE($8::timestamptz, NOW())
               WHERE EXISTS (SELECT 1 FROM note_checkins WHERE id = $2::uuid AND user_id = $1)
               ON CONFLICT (note_id) DO NOTHING`,
      userIdFirst: true,
    },
    {
      table: 'noteThemes',
      select: `SELECT id, label, description, color, size, created_at
               FROM note_themes WHERE user_id = $1`,
      insert: `INSERT INTO note_themes (user_id, id, label, description, color, size, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, NOW()))
               ON CONFLICT (id) DO NOTHING`,
      userIdFirst: true,
    },
    {
      table: 'noteThemeMembers',
      select: `SELECT m.note_id, m.theme_id, m.rank, m.score
               FROM note_theme_members m JOIN note_themes t ON t.id = m.theme_id
               WHERE t.user_id = $1`,
      insert: `INSERT INTO note_theme_members (note_id, theme_id, rank, score)
               SELECT $2::uuid, $3::uuid, $4, $5
               WHERE EXISTS (SELECT 1 FROM note_checkins WHERE id = $2::uuid AND user_id = $1)
                 AND EXISTS (SELECT 1 FROM note_themes WHERE id = $3::uuid AND user_id = $1)
               ON CONFLICT DO NOTHING`,
      userIdFirst: true,
    },
    {
      table: 'noteNeighbors',
      select: `SELECT nb.note_id, nb.neighbor_id, nb.similarity
               FROM note_neighbors nb JOIN note_checkins n ON n.id = nb.note_id
               WHERE n.user_id = $1`,
      insert: `INSERT INTO note_neighbors (note_id, neighbor_id, similarity)
               SELECT $2::uuid, $3::uuid, $4
               WHERE EXISTS (SELECT 1 FROM note_checkins WHERE id = $2::uuid AND user_id = $1)
                 AND EXISTS (SELECT 1 FROM note_checkins WHERE id = $3::uuid AND user_id = $1)
               ON CONFLICT DO NOTHING`,
      userIdFirst: true,
    },
  ],

  // FK order: tags -> notes -> links + embeddings -> themes -> members, neighbors
  backupOrder: ['noteTags', 'primary', 'noteTagLinks', 'noteEmbeddings', 'noteThemes', 'noteThemeMembers', 'noteNeighbors'],

  // Start-over: the notes (cascading to links, embeddings, members and
  // neighbors), their companions, and the themes they formed. Tags stay
  // until "reset settings" (they're the user's vocabulary, like Mood's activities).
  deleteUserData: async ({ user_id, client }) => {
    const run = client ?? db;
    const companions = await run.query(
      `DELETE FROM companions WHERE checkin_type = 'notes'
         AND checkin_id IN (SELECT id FROM note_checkins WHERE user_id = $1) RETURNING id`,
      [user_id],
    );
    const rows = await run.query('DELETE FROM note_checkins WHERE user_id = $1 RETURNING id', [user_id]);
    const themes = await run.query('DELETE FROM note_themes WHERE user_id = $1 RETURNING id', [user_id]);
    return (companions.rowCount ?? 0) + (rows.rowCount ?? 0) + (themes.rowCount ?? 0);
  },

  resetSettings: async ({ user_id, client }) => {
    const run = client ?? db;
    const tags = await run.query('DELETE FROM note_tags WHERE user_id = $1 RETURNING id', [user_id]);
    const themes = await run.query('DELETE FROM note_themes WHERE user_id = $1 RETURNING id', [user_id]);
    return (tags.rowCount ?? 0) + (themes.rowCount ?? 0);
  },

  settingsKeys: [
    { name: 'embedding_api_url', type: 'string', label: 'Embedding API URL' },
    { name: 'embedding_model', type: 'string', label: 'Embedding model' },
    { name: 'embedding_api_key', type: 'string', label: 'Embedding API key' },
    { name: 'similarity_threshold', type: 'number', label: 'Similarity Web link threshold', default: 0.6 },
    { name: 'include_mood_entries', type: 'boolean', label: 'Include mood check-ins with text in the similarity analysis', default: false },
  ],

  jobs: [
    {
      jobType: SIMILARITY_JOB,
      handler: async ({ isCancelled, updateProgress }) => {
        // Started from the user's request, so it runs as them.
        await runSimilarityAnalysis(currentUserId(), { isCancelled, updateProgress });
      },
    },
  ],

  // ------------------------------------------------------------------
  // Cross-cutting service hooks. Notes deliberately declare no
  // timezoneAnchors / latestTimezoneAsOf: imported notes take their zone
  // *from* the anchors (or a guessed fallback), so they shouldn't feed
  // other imports.
  // ------------------------------------------------------------------

  resolveTimestamps: () => ({
    sql: 'SELECT id, checked_in_at FROM note_checkins WHERE id = ANY($1::uuid[])',
  }),

  earliestDate: () => ({
    sql: `SELECT MIN(DATE(checked_in_at AT TIME ZONE COALESCE(checkin_timezone, 'UTC')))::text AS date
          FROM note_checkins WHERE user_id = $1`,
  }),

  reflectionBranch: () => ({
    sql: `
      SELECT
        'notes' AS type,
        n.id,
        n.checked_in_at,
        left(n.body, 600) AS note,
        NULL::uuid AS venue_id,
        NULL::text AS venue_name,
        NULL::text AS city,
        NULL::text AS country,
        NULL::double precision AS latitude,
        NULL::double precision AS longitude,
        NULL::text AS venue_category,
        NULL::text AS venue_timezone,
        EXTRACT(YEAR FROM ${LOCAL_TS})::int AS reflection_year,
        (EXTRACT(YEAR FROM $2::date)::int - EXTRACT(YEAR FROM ${LOCAL_TS})::int)::int AS years_ago,
        json_build_object(
          'title', n.title,
          'tags', ${tagsJsonSql('n.id')},
          'word_count', n.word_count,
          'checkin_timezone', n.checkin_timezone
        )::jsonb AS data
      FROM note_checkins n
      WHERE n.user_id = $1
        AND TO_CHAR(${LOCAL_TS}, 'MM-DD') = TO_CHAR($2::date, 'MM-DD')
        AND EXTRACT(YEAR FROM ${LOCAL_TS}) < EXTRACT(YEAR FROM $2::date)
    `,
  }),

  llm: {
    label: 'notes',
    gather: async (user_id, from, to) => {
      const result = await query(
        `SELECT n.checked_in_at, n.checkin_timezone AS timezone,
                json_build_object(
                  'title', n.title,
                  'tags', COALESCE((SELECT json_agg(t.name ORDER BY lower(t.name))
                                    FROM note_tag_links l JOIN note_tags t ON t.id = l.tag_id
                                    WHERE l.note_id = n.id), '[]'::json),
                  'companions', (${companionNamesSql('notes', 'n.id')}),
                  'excerpt', left(n.body, ${LLM_EXCERPT_CHARS + 1})
                )::jsonb AS data
         FROM note_checkins n
         WHERE n.user_id = $1
           AND ${LOCAL_TS}::date >= $2::date
           AND ${LOCAL_TS}::date <= $3::date
         ORDER BY n.checked_in_at ASC`,
        [user_id, from, to],
      );
      return result.rows;
    },
    toLines: (row: PluginLlmRow) => {
      const d = row.data as { title: string | null; tags: string[] | null; companions: string[] | null; excerpt: string | null };
      const when = formatLlmWhen(row.checked_in_at, row.timezone);
      const title = d.title ? ` "${d.title}"` : '';
      const tags = d.tags?.length ? ` [${d.tags.join(', ')}]` : '';
      const withWhom = d.companions?.length ? ` with ${d.companions.join(', ')}` : '';
      const raw = (d.excerpt ?? '').replace(/\s+/g, ' ').trim();
      const text = raw.length > LLM_EXCERPT_CHARS ? `${raw.slice(0, LLM_EXCERPT_CHARS)}…` : raw;
      return [`- ${when} — note${title}${tags}${withWhom}${text ? `: ${text}` : ''}`];
    },
  },

  reconcile: {
    anchorLabel: 'a note',
    detailPath: (id) => `/notes/${id}`,
    loadCheckins: async (user_id) => {
      const result = await query(
        `SELECT id, checked_in_at, checkin_timezone AS original_timezone
         FROM note_checkins WHERE user_id = $1 ORDER BY checked_in_at ASC`,
        [user_id],
      );
      return result.rows as PluginReconciliationRow[];
    },
    apply: async (id, suggested_timezone, executor) => {
      if (!isValidTimeZone(suggested_timezone)) return false;
      const result = await (executor ?? db).query(
        'UPDATE note_checkins SET checkin_timezone = $2 WHERE id = $1 AND user_id = $3 RETURNING id',
        [id, suggested_timezone, currentUserId()],
      );
      return (result.rowCount ?? 0) > 0;
    },
  },
};

export type { NoteRow };
export { bodyHash };
