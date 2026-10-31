/**
 * Notes check-in type — client API helpers for the plugin's `/notes` and
 * `/import/notes` routers.
 */

import { apiFetch, request } from '../../../client/src/api/client';

export interface NoteTag {
  id: string;
  name: string;
  color: string;
}

export interface NoteTagSummary extends NoteTag {
  note_count: number;
  word_count: number;
  last_used_at: string | null;
}

export interface NoteThemeRef {
  id: string;
  label: string;
  color: string;
  rank: 1 | 2;
}

export interface Note {
  id: string;
  title: string | null;
  body: string;
  checked_in_at: string;
  checkin_timezone: string | null;
  source: 'manual' | 'import';
  source_filename: string | null;
  word_count: number;
  created_at: string;
  updated_at: string;
  tags: NoteTag[];
  companions: string[];
  themes: NoteThemeRef[];
}

export interface NoteInput {
  title: string | null;
  body: string;
  checked_in_at: string;
  checkin_timezone: string | null;
  /** Tag names; unknown names become new tags. */
  tags: string[];
  companions: string[];
}

export interface RelatedNote {
  id: string;
  title: string | null;
  excerpt: string;
  checked_in_at: string;
  checkin_timezone: string | null;
  similarity: number;
  tags: NoteTag[];
  /** A mood check-in with text (when included in the analysis) opens at /mood-checkins/:id. */
  kind: 'note' | 'mood';
}

export interface NoteTheme {
  id: string;
  label: string;
  description: string | null;
  color: string;
  size: number;
}

export interface LibraryNote {
  id: string;
  title: string | null;
  excerpt: string;
  checked_in_at: string;
  checkin_timezone: string | null;
  local_date: string;
  word_count: number;
  tag_ids: string[];
  theme_id: string | null;
}

export interface Library {
  notes: LibraryNote[];
  tags: NoteTag[];
  themes: NoteTheme[];
}

export interface GraphNode {
  id: string;
  title: string | null;
  excerpt: string;
  local_date: string;
  word_count: number;
  tag_ids: string[];
  theme_id: string | null;
  kind: 'note' | 'mood';
}

export interface GraphEdge {
  source: string;
  target: string;
  similarity: number;
}

export interface NoteGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  tags: NoteTag[];
  themes: NoteTheme[];
}

export interface NoteStats {
  totals: {
    notes: number;
    words: number;
    avg_words: number;
    untagged: number;
    days_written: number;
    longest_words: number | null;
  };
  by_tag: (NoteTag & { notes: number; words: number; avg_words: number; first_at: string; last_at: string })[];
  tag_months: { month: string; tag_id: string | null; notes: number }[];
  /** ISO day of week (1 = Monday) × local hour. */
  rhythm: { dow: number; hour: number; notes: number }[];
  themes: { id: string; label: string; description: string | null; color: string; notes: number }[];
  theme_years: { year: number; theme_id: string; notes: number }[];
  theme_tags: { theme_id: string; tag_id: string; notes: number }[];
}

export interface AnalysisStatus {
  embeddings_configured: boolean;
  embedding_model: string | null;
  llm_configured: boolean;
  include_mood_entries: boolean;
  /** Mood check-ins with text (0 unless included). */
  mood_total: number;
  total: number;
  pending: number;
  analyzed: number;
  themes: number;
  last_run_at: string | null;
  active_job_id: string | null;
}

export type TimeSource = 'file_modified' | 'default_evening' | 'missing';
export type TimezoneSource = 'history' | 'fallback';
export type DuplicateKind = 'date_title' | 'content' | 'batch';

export interface ImportPreviewRow {
  index: number;
  filename: string;
  title: string | null;
  excerpt: string;
  checked_in_at: string;
  timezone: string;
  local_date: string;
  time_source: TimeSource;
  tz_source: TimezoneSource;
  duplicate: DuplicateKind | null;
  selected_default: boolean;
  error: string | null;
  word_count: number;
}

export interface ImportPreview {
  total: number;
  selected: number;
  fallback_count: number;
  duplicate_count: number;
  rows: ImportPreviewRow[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  imported_ids: string[];
  errors: string[];
  total_errors: number;
}

/** A tag rename that collides with another tag's name. */
export class TagConflictError extends Error {
  constructor(message: string, readonly conflictId: string, readonly conflictName: string) {
    super(message);
  }
}

const BASE = '/notes';

function rangeQuery(from?: string, to?: string): string {
  const qp = new URLSearchParams();
  if (from) qp.set('from', from);
  if (to) qp.set('to', to);
  const s = qp.toString();
  return s ? `?${s}` : '';
}

async function postImportForm<T>(path: string, files: File[], fields: Record<string, string>): Promise<T> {
  const form = new FormData();
  form.append('meta', JSON.stringify(files.map((f) => ({ name: f.name, lastModified: f.lastModified || null }))));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) form.append('files', file, file.name);
  const res = await apiFetch(`/api/v1/import/notes${path}`, { method: 'POST', body: form });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || error.message || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const notes = {
  list: (params?: Record<string, string>) => request<Note[]>(`${BASE}/checkins?${new URLSearchParams(params)}`),
  get: (id: string) => request<Note>(`${BASE}/checkins/${id}`),
  create: (data: NoteInput) => request<Note>(`${BASE}/checkins`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: NoteInput) =>
    request<Note>(`${BASE}/checkins/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ id: string }>(`${BASE}/checkins/${id}`, { method: 'DELETE' }),
  related: (id: string, limit = 6) =>
    request<{ analyzed: boolean; related: RelatedNote[] }>(`${BASE}/checkins/${id}/related?limit=${limit}`),

  tags: () => request<NoteTagSummary[]>(`${BASE}/tags`),
  createTag: (name: string, color?: string) =>
    request<NoteTag>(`${BASE}/tags`, { method: 'POST', body: JSON.stringify({ name, color }) }),
  updateTag: async (id: string, data: { name?: string; color?: string }): Promise<NoteTag> => {
    const res = await apiFetch(`/api/v1${BASE}/tags/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) throw new TagConflictError(body.error, body.conflict_id, body.conflict_name);
    if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`);
    return body;
  },
  mergeTag: (id: string, intoId: string) =>
    request<{ merged: true; notes_moved: number }>(`${BASE}/tags/${id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ into_id: intoId }),
    }),
  deleteTag: (id: string) =>
    request<{ deleted: true; notes_untagged: number }>(`${BASE}/tags/${id}`, { method: 'DELETE' }),

  library: () => request<Library>(`${BASE}/library`),
  graph: () => request<NoteGraph>(`${BASE}/graph`),
  stats: (from?: string, to?: string) => request<NoteStats>(`${BASE}/stats${rangeQuery(from, to)}`),
  analysisStatus: () => request<AnalysisStatus>(`${BASE}/analysis/status`),
};

export const notesImport = {
  preview: (files: File[], fallbackTimezone: string) =>
    postImportForm<ImportPreview>('/preview', files, { fallback_timezone: fallbackTimezone }),
  run: (files: File[], fallbackTimezone: string, selected: number[], tags: string[]) =>
    postImportForm<ImportResult>('', files, {
      fallback_timezone: fallbackTimezone,
      selected: JSON.stringify(selected),
      tags: JSON.stringify(tags),
    }),
};

/**
 * A tag chip's tint and border from its color. Text stays in the neutral ink
 * classes (TAG_TEXT_CLASS) so it's readable on any tag color in both themes.
 */
export function tagChipStyle(hex: string): { backgroundColor: string; borderColor: string } {
  return { backgroundColor: `${hex}24`, borderColor: `${hex}80` };
}

export const TAG_TEXT_CLASS = 'text-gray-800 dark:text-gray-100';
