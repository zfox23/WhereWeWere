/**
 * The companions, kinds of place and moods a song, artist or genre is played
 * around: plays within the listening-session gap of those check-ins, over the
 * whole history. Companions and places open Home filtered to them.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Headphones } from 'lucide-react';
import { music } from '../api';
import type { LifeBy, Tie, Ties } from '../types';
import { ChartCard } from './ChartCard';
import { groupLabel } from './MusicLifeCard';

const KINDS: { by: LifeBy; title: string; home?: (t: Tie) => string }[] = [
  { by: 'companion', title: 'Companions', home: (t) => `/?${new URLSearchParams({ companion: t.label })}` },
  { by: 'place', title: 'Places', home: (t) => `/?${new URLSearchParams({ category: t.label })}` },
  { by: 'mood', title: 'Moods' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function TiesCard({ scope }: { scope: { songKey: string } | { artist: string } | { genre: string } }) {
  const [ties, setTies] = useState<Ties | null>(null);
  const [error, setError] = useState(false);
  const id = 'songKey' in scope ? `s:${scope.songKey}` : 'artist' in scope ? `a:${scope.artist}` : `g:${scope.genre}`;

  useEffect(() => {
    let cancelled = false;
    setTies(null);
    setError(false);
    music
      .ties(scope)
      .then((t) => !cancelled && setTies(t))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
    // `id` stands for the scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const empty = ties != null && KINDS.every((k) => ties[k.by].length === 0);

  return (
    <ChartCard title="Played around" icon={Headphones} loading={!ties && !error}>
      {error ? (
        <p className="text-xs text-red-500">Couldn't load companions, places and moods.</p>
      ) : empty ? (
        <p className="text-xs text-gray-500">Not played around any check-ins with companions, a place or a mood yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {KINDS.map(({ by, title, home }) => {
              const rows = ties?.[by] ?? [];
              const max = Math.max(...rows.map((t) => t.plays), 1);
              return (
                <div key={by}>
                  <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{title}</h4>
                  {rows.length === 0 ? (
                    <p className="text-xs text-gray-400">{ties ? 'None' : '…'}</p>
                  ) : (
                    <ol className="space-y-1.5" aria-label={title}>
                      {rows.map((t) => {
                        const label = groupLabel(by, t);
                        return (
                          <li key={t.key} className="text-sm">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="min-w-0 truncate text-gray-900 dark:text-gray-100">
                                {home ? (
                                  <Link to={home(t)} title={`Show ${label} on Home`} className="hover:underline decoration-dotted underline-offset-2">
                                    {label}
                                  </Link>
                                ) : (
                                  label
                                )}
                              </span>
                              <span
                                className="shrink-0 text-xs tabular-nums text-gray-500"
                                title={`${plural(t.plays, 'play')} around ${plural(t.checkins, 'check-in')}`}
                              >
                                {t.plays}
                              </span>
                            </div>
                            <div className="mt-0.5 h-1 rounded-full bg-gray-100 dark:bg-gray-800">
                              <div className="h-1 rounded-full bg-pink-400/80" style={{ width: `${(t.plays / max) * 100}%` }} />
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              );
            })}
          </div>
          {ties && (
            <p className="mt-3 text-[11px] text-gray-400">
              Plays within {ties.gap_minutes} minutes of a check-in (the listening-session gap in Settings → Music).
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}
