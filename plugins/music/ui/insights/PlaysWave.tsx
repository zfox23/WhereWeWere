/**
 * Plays over time on album, artist, playlist and list pages, as a wave (see
 * WaveChart): one band per most played song (or list item), so the chart
 * shows both how much was played and what. Week / month / year, like the bar
 * chart it replaces; the rest are summed in a line below the chart, and the
 * popup gives each moment's full total.
 */

import { useMemo } from 'react';
import { Waves } from 'lucide-react';
import type { PlaySeries } from '../types';
import { ChartCard, Toggle } from './ChartCard';
import { bucketize, bucketLabel, type Bucket, type BucketCount } from './timeline';
import { pct, WaveChart, type WaveData } from './WaveChart';

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

/** The series grouped into `bucket`s on one shared axis, from the first play of any band (or Other) to the last. */
export function seriesWave(series: PlaySeries, bucket: Bucket): { wave: WaveData; buckets: BucketCount[] } {
  const days = [...series.bands.flatMap((b) => b.daily), ...series.other.daily].map((d) => d.date).sort();
  if (days.length === 0) return { wave: { names: [], buckets: [] }, buckets: [] };
  const range = { first: days[0], last: days[days.length - 1] };
  const bands = series.bands.map((b) => bucketize(b.daily, bucket, range));
  const other = bucketize(series.other.daily, bucket, range);
  return {
    buckets: other,
    wave: {
      names: series.bands.map((b) => b.name),
      buckets: other.map((o, i) => ({ counts: bands.map((b) => b[i].plays), other: o.plays })),
    },
  };
}

export function PlaysWave({
  series,
  bucket,
  onBucketChange,
  title = 'Plays over time',
  noun = 'song',
  bandHref,
}: {
  series: PlaySeries;
  bucket: Bucket;
  onBucketChange: (b: Bucket) => void;
  title?: string;
  /** What a band is: 'song', or 'item' on a list. */
  noun?: string;
  /** Where clicking a band goes, from its key. */
  bandHref?: (key: string) => string | null;
}) {
  const { wave, buckets } = useMemo(() => seriesWave(series, bucket), [series, bucket]);
  const drawn = series.bands.reduce((n, b) => n + b.plays, 0);
  const all = drawn + series.other.plays;
  const nouns = `${noun}s`;

  return (
    <ChartCard
      title={title}
      icon={Waves}
      controls={<Toggle label="Group plays by" value={bucket} onChange={onBucketChange} options={BUCKETS} />}
    >
      {buckets.length === 0 ? (
        <p className="text-xs text-gray-500">No plays yet.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {series.other.plays > 0
              ? `Plays per ${bucket} of the ${series.bands.length} most played ${nouns}, ${pct(drawn, all)}% of all plays.`
              : `Plays per ${bucket}, by ${noun}.`}
          </p>
          <WaveChart
            data={wave}
            label={(i) => bucketLabel(buckets[i], bucket)}
            ariaLabel={`Plays per ${bucket} by ${noun}`}
            otherLabel={`Other ${nouns}`}
            bandHref={bandHref ? (i) => bandHref(series.bands[i].key) : undefined}
          />
          {series.other.plays > 0 && (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Other {nouns}, not drawn: {series.other.plays.toLocaleString()} play{series.other.plays === 1 ? '' : 's'} of{' '}
              {series.other.count.toLocaleString()} more {series.other.count === 1 ? noun : nouns}.
            </p>
          )}
        </>
      )}
    </ChartCard>
  );
}
