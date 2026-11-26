/**
 * A list's "Export to Spotify" (first time) or "Update on Spotify" (later):
 * the list becomes a private Spotify playlist, which later exports replace the
 * tracks of. Shown only while Spotify is connected. Items with no Spotify
 * match are listed after each export.
 */

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Upload } from 'lucide-react';
import { spotify } from './api';
import { formatDay, joinArtists } from './format';
import { useSpotifyStatus } from './useSpotifyStatus';
import type { SpotifyExport } from './types';

export function SpotifyExportButton({ listId }: { listId: string }) {
  const status = useSpotifyStatus();
  const connected = status?.connected ?? false;
  const [current, setCurrent] = useState<{ listId: string; exp: SpotifyExport | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justExported, setJustExported] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    setError(null);
    setJustExported(false);
    spotify
      .getExport(listId)
      .then((exp) => !cancelled && setCurrent({ listId, exp }))
      .catch(() => !cancelled && setCurrent({ listId, exp: null }));
    return () => {
      cancelled = true;
    };
  }, [connected, listId]);

  if (!connected) return null;
  const exp = current?.listId === listId ? current.exp : null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setCurrent({ listId, exp: await spotify.exportList(listId) });
      setJustExported(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy || !current}
          title={exp ? "Replace the Spotify playlist's tracks with this list's" : 'Make a private Spotify playlist of this list'}
          className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {exp ? 'Update on Spotify' : 'Export to Spotify'}
        </button>
        {exp && (
          <a href={exp.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
            <ExternalLink size={12} />
            Spotify playlist
          </a>
        )}
      </span>
      {error && <span className="text-xs text-red-600">{error}</span>}
      {exp && justExported && (
        <span className="text-xs text-gray-600 dark:text-gray-300" role="status">
          {exp.created ? 'Created' : 'Updated'} with {exp.track_count.toLocaleString()} track{exp.track_count === 1 ? '' : 's'}.
        </span>
      )}
      {exp && !justExported && (
        <span className="text-xs text-gray-500 dark:text-gray-400">Last exported {formatDay(exp.exported_at)}</span>
      )}
      {exp && exp.unmatched.length > 0 && (
        <details className="text-xs text-amber-700 dark:text-amber-400">
          <summary className="cursor-pointer">
            {exp.unmatched.length} item{exp.unmatched.length === 1 ? '' : 's'} not found on Spotify
          </summary>
          <ul className="mt-1 list-disc pl-5 text-gray-600 dark:text-gray-300">
            {exp.unmatched.map((u, i) => (
              <li key={`${u.kind}-${u.title}-${i}`}>
                {u.title}
                {u.artists.length > 0 && <span className="text-gray-500"> · {joinArtists(u.artists)}</span>}
                {u.kind === 'album' && <span className="text-gray-500"> (album)</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </span>
  );
}
