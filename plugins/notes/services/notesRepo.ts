/**
 * Notes plugin — row shapes, input validation and tag helpers shared by the
 * CRUD routes and the file importer.
 */

import { isValidTimeZone } from 'wwp-shared';
import { query } from '../../../server/src/db';
import { MAX_BODY_LENGTH, MAX_TAG_LENGTH, MAX_TITLE_LENGTH, TAG_PALETTE } from '../manifest';

/** Anything with a pg-style `query` (the pool helper or a transaction client). */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

export const db: Queryable = { query };

export class InputError extends Error {}

export interface NoteTag {
  id: string;
  name: string;
  color: string;
}

export interface NoteRow {
  id: string;
  user_id: string;
  title: string | null;
  body: string;
  checked_in_at: string | Date;
  checkin_timezone: string | null;
  source: 'manual' | 'import';
  source_filename: string | null;
  content_hash: string;
  word_count: number;
  created_at: string | Date;
  updated_at: string | Date;
  tags: NoteTag[];
}

/** Columns a note row is stored with (generated columns excluded): backup + restore. */
export const NOTE_STORED_COLUMNS = `id, user_id, title, body, checked_in_at, checkin_timezone,
  source, source_filename, created_at, updated_at`;

/** A correlated subquery: the note's tags as a JSON array (alphabetical). */
export function tagsJsonSql(noteIdExpr: string): string {
  return `COALESCE((
    SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY lower(t.name))
    FROM note_tag_links l JOIN note_tags t ON t.id = l.tag_id
    WHERE l.note_id = ${noteIdExpr}
  ), '[]'::json)`;
}

export const NOTE_SELECT = `n.id, n.user_id, n.title, n.body, n.checked_in_at, n.checkin_timezone,
  n.source, n.source_filename, n.content_hash, n.word_count, n.created_at, n.updated_at,
  ${tagsJsonSql('n.id')} AS tags`;

export async function loadNote(userId: string, id: string, executor: Queryable = db): Promise<NoteRow | null> {
  const result = await executor.query(
    `SELECT ${NOTE_SELECT} FROM note_checkins n WHERE n.id = $1 AND n.user_id = $2`,
    [id, userId],
  );
  return (result.rows[0] as NoteRow | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface NoteInput {
  title: string | null;
  body: string;
  checked_in_at: string;
  checkin_timezone: string | null;
  tags: string[];
}

/** Trimmed, case-insensitively de-duplicated tag names. */
export function normalizeTagNames(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new InputError('tags must be an array of names');
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new InputError('tags must be an array of names');
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > MAX_TAG_LENGTH) throw new InputError(`Tag names are limited to ${MAX_TAG_LENGTH} characters`);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * The markdown exactly as written apart from line endings, a BOM, and
 * trailing whitespace. The importer hashes this same form to spot files
 * that were already imported.
 */
export function normalizeBody(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
}

export function parseNoteInput(body: Record<string, unknown>): NoteInput {
  const rawTitle = body.title;
  if (rawTitle != null && typeof rawTitle !== 'string') throw new InputError('title must be a string');
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (title.length > MAX_TITLE_LENGTH) throw new InputError(`title is too long (max ${MAX_TITLE_LENGTH} characters)`);

  const rawBody = body.body ?? '';
  if (typeof rawBody !== 'string') throw new InputError('body must be a string');
  const text = normalizeBody(rawBody);
  if (text.length > MAX_BODY_LENGTH) throw new InputError(`The note is too long (max ${MAX_BODY_LENGTH} characters)`);
  if (!title && !/\S/.test(text)) throw new InputError('Write something, or at least give the note a title');

  let checkedInAt = new Date().toISOString();
  if (body.checked_in_at != null) {
    const d = new Date(String(body.checked_in_at));
    if (Number.isNaN(d.getTime())) throw new InputError('checked_in_at must be a valid date-time');
    checkedInAt = d.toISOString();
  }

  const tz = body.checkin_timezone ?? null;
  if (tz !== null && (typeof tz !== 'string' || !isValidTimeZone(tz))) {
    throw new InputError('checkin_timezone must be a valid IANA timezone');
  }

  return {
    title: title || null,
    body: text,
    checked_in_at: checkedInAt,
    checkin_timezone: tz as string | null,
    tags: normalizeTagNames(body.tags),
  };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * Ids of the named tags, creating the missing ones (matched
 * case-insensitively; new tags take the next palette color).
 */
export async function resolveTags(executor: Queryable, userId: string, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const existing = await executor.query(
    'SELECT id, lower(name) AS key FROM note_tags WHERE user_id = $1 AND lower(name) = ANY($2::text[])',
    [userId, names.map((n) => n.toLowerCase())],
  );
  const byKey = new Map<string, string>(existing.rows.map((r) => [r.key as string, r.id as string]));
  const missing = names.filter((n) => !byKey.has(n.toLowerCase()));
  if (missing.length > 0) {
    const count = await executor.query('SELECT COUNT(*)::int AS n FROM note_tags WHERE user_id = $1', [userId]);
    let next = count.rows[0].n as number;
    for (const name of missing) {
      const color = TAG_PALETTE[next++ % TAG_PALETTE.length];
      // DO UPDATE (a no-op) so a concurrent insert of the same name still returns its id.
      const inserted = await executor.query(
        `INSERT INTO note_tags (user_id, name, color) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = note_tags.name
         RETURNING id`,
        [userId, name, color],
      );
      byKey.set(name.toLowerCase(), inserted.rows[0].id as string);
    }
  }
  return names.map((n) => byKey.get(n.toLowerCase())!);
}

/** Replace a note's tags with exactly `tagIds`. */
export async function setNoteTags(executor: Queryable, noteId: string, tagIds: string[]): Promise<void> {
  await executor.query('DELETE FROM note_tag_links WHERE note_id = $1 AND NOT (tag_id = ANY($2::uuid[]))', [noteId, tagIds]);
  if (tagIds.length > 0) {
    await executor.query(
      `INSERT INTO note_tag_links (note_id, tag_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [noteId, tagIds],
    );
  }
}

/** Add `tagIds` to each of `noteIds` (keeps existing tags). */
export async function addTagsToNotes(executor: Queryable, noteIds: string[], tagIds: string[]): Promise<void> {
  if (noteIds.length === 0 || tagIds.length === 0) return;
  await executor.query(
    `INSERT INTO note_tag_links (note_id, tag_id)
     SELECT n, t FROM unnest($1::uuid[]) AS n CROSS JOIN unnest($2::uuid[]) AS t
     ON CONFLICT DO NOTHING`,
    [noteIds, tagIds],
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** First non-empty line of a note, stripped of leading markdown markers. */
export function firstLine(body: string, max = 140): string {
  const line = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const plain = line.replace(/^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s*|\d+[.)]\s+)/, '');
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
