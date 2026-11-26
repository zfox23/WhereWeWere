/**
 * Plays over time on album, artist, playlist and list pages, as a wave (see
 * WaveChart, which also zooms and pans): one band per most played song (or
 * list item), so the chart shows both how much was played and what. Week /
 * month / year picks the full view's grouping, like the bar chart it
 * replaces; the rest are summed in a line below the chart, and the popup
 * gives each moment's full total.
 */

import { useEffect, useMemo, useState } from 'react';
import { Waves } from 'lucide-react';
import type { PlaySeries } from '../types';
import { ChartCard, Toggle } from './ChartCard';
import type { Bucket } from './timeline';
import { denseSeries, pct, WaveChart, type WaveSeries } from './WaveChart';
import { rangeLabel, RerankButton, type ViewRange } from './RerankButton';

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

/** The series as dense days on one axis, from the first play of any band (or Other) to the last. */
export function seriesWave(series: PlaySeries): WaveSeries | null {
  return denseSeries(
    series.bands.map((b) => b.name),
    series.bands.map((b) => b.daily),
    series.other.daily,
  );
}

export function PlaysWave({
  series: given,
  bucket,
  onBucketChange,
  title = 'Plays over time',
  noun = 'song',
  bandHref,
  rerank,
}: {
  series: PlaySeries;
  bucket: Bucket;
  onBucketChange: (b: Bucket) => void;
  title?: string;
  /** What a band is: 'song', or 'item' on a list. */
  noun?: string;
  /** Where clicking a band goes, from its key. */
  bandHref?: (key: string) => string | null;
  /** The same series with its bands the most played in a window; offers the button when given. */
  rerank?: (range: ViewRange) => Promise<PlaySeries>;
}) {
  // Re-picked bands last until the button is pressed again or the page's series changes.
  const [ranked, setRanked] = useState<{ series: PlaySeries; range: ViewRange } | null>(null);
  const [view, setView] = useState<ViewRange | null>(null);
  useEffect(() => setRanked(null), [given]);
  const series = ranked?.series ?? given;
  const wave = useMemo(() => seriesWave(series), [series]);
  const drawn = series.bands.reduce((n, b) => n + b.plays, 0);
  const all = drawn + series.other.plays;
  const nouns = `${noun}s`;

  return (
    <ChartCard
      title={title}
      icon={Waves}
      controls={
        <div className="flex items-center gap-1">
          {rerank && wave && (
            <RerankButton range={view} run={async (range) => setRanked({ series: await rerank(range), range })} />
          )}
          <Toggle label="Group plays by" value={bucket} onChange={onBucketChange} options={BUCKETS} />
        </div>
      }
    >
      {!wave ? (
        <p className="text-xs text-gray-500">No plays yet.</p>
      ) : (
        <>
          <WaveChart
            series={wave}
            base={bucket}
            caption={(g) =>
              (series.other.plays > 0
                ? `Plays per ${g} of the ${series.bands.length} most played ${nouns}${ranked ? ` for ${rangeLabel(ranked.range)}` : ''}, ${pct(drawn, all)}% of all plays.`
                : `Plays per ${g}, by ${noun}.`)
            }
            ariaLabel={(g) => `Plays per ${g} by ${noun}`}
            otherLabel={`Other ${nouns}`}
            bandHref={bandHref ? (i) => bandHref(series.bands[i].key) : undefined}
            onViewRange={setView}
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
