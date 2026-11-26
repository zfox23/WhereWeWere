/**
 * Genres as small chips that open the genre's page, and the editor on album
 * and artist pages for correcting what MusicBrainz says.
 *
 * A play takes its album's genres, or its first artist's when the album has
 * none, so the album editor shows the artist's genres as what is used while
 * the album has none of its own.
 */

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Loader2, Pencil, Tags, X } from 'lucide-react';
import { music } from './api';
import { GenreLink } from './links';
import type { GenreCount, ItemGenres } from './types';

const CHIP =
  'inline-flex items-center gap-1 rounded-full border border-pink-200 bg-pink-50 px-2 py-0.5 text-xs font-medium text-pink-800 dark:border-pink-800/60 dark:bg-pink-900/20 dark:text-pink-200';

/** Genres as chips linking to their pages; `plays` (when given) shows in each chip's tooltip. */
export function GenreChips({
  genres,
  max,
  label = 'Genres',
}: {
  genres: (string | GenreCount)[];
  /** Show at most this many, with "+n" for the rest. */
  max?: number;
  label?: string;
}) {
  if (genres.length === 0) return null;
  const shown = max ? genres.slice(0, max) : genres;
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label={label}>
      {shown.map((g) => {
        const name = typeof g === 'string' ? g : g.name;
        const plays = typeof g === 'string' ? null : g.plays;
        return (
          <li key={name}>
            <GenreLink name={name} className={`${CHIP} hover:border-pink-400 hover:bg-pink-100 dark:hover:bg-pink-900/40`}>
              <span title={plays != null ? `${plays.toLocaleString()} play${plays === 1 ? '' : 's'}` : undefined}>{name}</span>
            </GenreLink>
          </li>
        );
      })}
      {max && genres.length > max && <li className="text-xs text-gray-500">+{genres.length - max}</li>}
    </ul>
  );
}

/** Genres every play has been seen with, for the editor's suggestions; fetched once per page load. */
let known: Promise<GenreCount[]> | null = null;
const knownGenres = () => {
  known ??= music.genres().catch(() => {
    known = null;
    return [];
  });
  return known;
};

function statusText(value: ItemGenres): string {
  if (value.edited) return 'Edited by you';
  if (value.lookup === 'found') return 'From MusicBrainz';
  if (value.lookup === 'not_found') return 'MusicBrainz has no genres for this';
  return 'Not looked up yet (Settings → Music → Genres)';
}

/**
 * An album's or artist's genres, editable. `fallback` names what plays use
 * while there are none (an album's artist).
 */
export function GenreEditor({
  kind,
  itemRef,
  value,
  fallback,
  onSaved,
}: {
  kind: 'album' | 'artist';
  /** The album's ref or the artist's name. */
  itemRef: string;
  value: ItemGenres;
  fallback?: { label: string; genres: string[] };
  onSaved: (next: ItemGenres) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(value.genres);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<GenreCount[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    if (editing) void knownGenres().then(setSuggestions);
  }, [editing]);

  const open = () => {
    setDraft(value.genres);
    setInput('');
    setError(null);
    setEditing(true);
  };

  const normalize = (raw: string) => raw.toLowerCase().replace(/\s+/g, ' ').trim();
  /** The draft with whatever is still typed in the box. */
  const withTyped = (list: string[], raw: string) => {
    const g = normalize(raw);
    return g && !list.includes(g) ? [...list, g] : list;
  };
  const add = (raw: string) => {
    setDraft((d) => withTyped(d, raw));
    setInput('');
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(input);
    } else if (e.key === 'Backspace' && input === '' && draft.length > 0) {
      setDraft(draft.slice(0, -1));
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  const save = async (genres: string[] | null) => {
    setSaving(true);
    setError(null);
    try {
      const next = await music.setGenres(kind, itemRef, genres);
      known = null;
      onSaved(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the genres.");
    } finally {
      setSaving(false);
    }
  };

  const usingFallback = value.genres.length === 0 && fallback && fallback.genres.length > 0;

  return (
    <section aria-label="Genres" className="mt-2 space-y-1">
      {!editing ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tags size={14} className="text-pink-500" aria-hidden />
          {value.genres.length > 0 ? (
            <GenreChips genres={value.genres} />
          ) : usingFallback ? (
            <>
              <span className="text-xs text-gray-500 dark:text-gray-400">{fallback!.label}:</span>
              <GenreChips genres={fallback!.genres} />
            </>
          ) : (
            <span className="text-xs text-gray-500 dark:text-gray-400">No genres</span>
          )}
          <button
            type="button"
            onClick={open}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20"
            aria-label={`Edit genres of this ${kind}`}
          >
            <Pencil size={12} /> Edit
          </button>
          <span className="text-[11px] text-gray-400">{statusText(value)}</span>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-white/70 p-2 dark:border-gray-700 dark:bg-gray-900/60">
          <div className="flex flex-wrap items-center gap-1">
            {draft.map((g) => (
              <span key={g} className={CHIP}>
                {g}
                <button
                  type="button"
                  onClick={() => setDraft(draft.filter((x) => x !== g))}
                  aria-label={`Remove ${g}`}
                  className="rounded-full text-pink-500 hover:text-pink-800 dark:hover:text-pink-100"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              onBlur={() => input.trim() && add(input)}
              list={listId}
              placeholder={draft.length ? 'Add another' : 'Add a genre'}
              aria-label="Add a genre"
              maxLength={60}
              autoFocus
              className="input min-w-[8rem] flex-1 py-0.5 text-xs"
            />
            <datalist id={listId}>
              {suggestions.filter((s) => !draft.includes(s.name)).map((s) => (
                <option key={s.name} value={s.name} />
              ))}
            </datalist>
          </div>
          {draft.length > 1 && (
            <p className="text-[11px] text-gray-500">The first genre is the main one, used by Genres over time.</p>
          )}
          {kind === 'album' && draft.length === 0 && (
            <p className="text-[11px] text-gray-500">With no genres of its own, its plays use the artist's genres.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void save(withTyped(draft, input))} disabled={saving} className="btn-primary px-3 py-1 text-xs">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-secondary px-3 py-1 text-xs">
              Cancel
            </button>
            {value.edited && (
              <button
                type="button"
                onClick={() => void save(null)}
                disabled={saving}
                className="text-xs font-medium text-primary-600 hover:underline"
                title={value.catalog_genres.length ? `MusicBrainz: ${value.catalog_genres.join(', ')}` : undefined}
              >
                Use MusicBrainz's genres
              </button>
            )}
            {saving && <Loader2 size={14} className="animate-spin text-primary-600" />}
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </section>
  );
}
