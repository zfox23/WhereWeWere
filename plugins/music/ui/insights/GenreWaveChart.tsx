/**
 * Genres over time, as a wave (see WaveChart): one band per genre, its
 * thickness the genre's plays in each week, month or year of the period (the
 * same bucket sizes as Discovery). The period's eight most played genres get
 * bands; everything else is summed in a line of text below the chart, since
 * one band for dozens of small genres would dwarf the rest. Each play counts
 * once, toward its main genre (its first: most votes on MusicBrainz, or first
 * in the user's edit), so near-duplicates such as "electronic" and "edm"
 * don't both swell the wave.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Waves } from 'lucide-react';
import { music } from '../api';
import { genrePath, GenreLink } from '../links';
import type { GenreStream } from '../types';
import { ChartCard } from './ChartCard';
import { bucketLabel } from './DiscoveryChart';
import { pct, WaveChart, type WaveData } from './WaveChart';

const plays = (n: number) => `${n.toLocaleString()} play${n === 1 ? '' : 's'}`;

export function GenreWaveChart({ from, to }: { from?: string; to?: string }) {
  const [data, setData] = useState<GenreStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    music
      .genreStream(from, to)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(false);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const wave = useMemo<WaveData | null>(() => (data ? { names: data.genres, buckets: data.buckets } : null), [data]);
  const coverage = data && data.plays > 0 ? pct(data.plays_with_genres, data.plays) : 100;
  const other = data?.other;

  return (
    <ChartCard title="Genres over time" icon={Waves} loading={loading}>
      {error ? (
        <p className="text-xs text-red-500">Couldn't load genres.</p>
      ) : !data || !wave || data.plays === 0 ? (
        !loading && <p className="text-xs text-gray-500">Nothing played in this period.</p>
      ) : data.plays_with_genres === 0 ? (
        <p className="text-xs text-gray-500">
          None of this period's plays have genres yet. Look them up in{' '}
          <Link to="/settings?tab=plugin:music" className="font-medium text-primary-600 hover:underline">
            Settings → Music
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Plays per {data.bucket} by each play's main genre (its first listed).
            {coverage < 100 && ` ${coverage}% of plays have genres.`}
          </p>
          <WaveChart
            data={wave}
            label={(i) => bucketLabel(data.buckets[i].start, data.bucket)}
            ariaLabel={`Plays per ${data.bucket} of the top genres`}
            otherLabel="Other genres"
            bandHref={(i) => genrePath(data.genres[i])}
          />
          {other && other.plays > 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Other genres, not drawn: {plays(other.plays)} across {other.genres.toLocaleString()} more genre
              {other.genres === 1 ? '' : 's'}
              {other.top.length > 0 && (
                <>
                  {' '}
                  (most:{' '}
                  {other.top.map((g, i) => (
                    <span key={g.name}>
                      {i > 0 && ', '}
                      <GenreLink name={g.name} /> <span className="tabular-nums">{g.plays.toLocaleString()}</span>
                    </span>
                  ))}
                  {other.genres > other.top.length ? ', …' : ''})
                </>
              )}
              .
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}
