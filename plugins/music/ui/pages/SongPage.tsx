/**
 * One song as a page of its own (/music/song?key=…): its totals and rank,
 * streaks and peaks, when in the day and week it's played, the companions,
 * places and moods it's played around, plays over time, and every play.
 *
 * Clicking a bar of the chart (or using the period picker) narrows the plays
 * to that week, month or year; a month can be narrowed again to one of its
 * weeks. The chart's grouping and the period live in the URL, replaced rather
 * than pushed, so Back always returns to the page the song was opened from.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Home, Loader2, X } from 'lucide-react';
import { BackButton } from '../../../../client/src/components/BackButton';
import { PeriodRangeSelector } from '../../../../client/src/components/PeriodRangeSelector';
import { PagingFooter } from '../../../../client/src/components/lists/PagingFooter';
import { usePagedLibrary } from '../../../../client/src/hooks/usePagedLibrary';
import { useScrollRestoration } from '../../../../client/src/hooks/useScrollRestoration';
import { usePageTitle } from '../../../../client/src/utils/pageTitle';
import { getPeriodDateRange, getPeriodRangeLabel, isValidDateParam, isValidMonthParam, parsePeriodParam, type PeriodMode } from '../../../../client/src/utils/periodRange';
import { albumArtUrl, music } from '../api';
import { AlbumLink } from '../AlbumLink';
import { formatClock, formatDateKey, formatDay, formatDuration, formatLength, sourceLabel, UNKNOWN_ALBUM } from '../format';
import { homeDayLink } from '../homeLinks';
import { ArtistLinks, albumPath } from '../links';
import { GenreChips } from '../GenreChips';
import { ListBadge, songItemKey } from '../ListBadge';
import { playPath } from '../listTitle';
import { ClockCard } from '../insights/ListeningClock';
import { PlaysOverTime } from '../insights/PlaysOverTime';
import { StreaksAndPeaks } from '../insights/StreaksAndPeaks';
import { TiesCard } from '../insights/TiesCard';
import { bucketEnd, bucketLabel, bucketStart, weeksOfMonth, type Bucket, type BucketCount } from '../insights/timeline';
import type { SongDetail, SongPlay } from '../types';

const PAGE_SIZE = 100;
const BUCKETS: Bucket[] = ['week', 'month', 'year'];

function PlayRow({ play }: { play: SongPlay }) {
  const length = formatLength(play.listened_for ?? play.track_length);
  const home = play.session_id ? homeDayLink(play.session_date, play.session_id) : null;
  return (
    <li className="flex items-center gap-2 py-1.5 text-sm">
      <Link
        to={playPath(play.id)}
        title={sourceLabel(play.source)}
        className="flex min-w-0 flex-1 items-baseline gap-2 rounded hover:text-pink-700 dark:hover:text-pink-300"
      >
        <span className="w-24 shrink-0 tabular-nums text-gray-900 dark:text-gray-100 sm:w-28">{formatDay(play.played_at, play.timezone)}</span>
        <span className="w-24 shrink-0 tabular-nums text-xs text-gray-500 dark:text-gray-400">{formatClock(play.played_at, play.timezone, true)}</span>
        <span className="hidden min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-300 sm:inline">{play.album ?? UNKNOWN_ALBUM}</span>
        <span className="ml-auto w-10 shrink-0 text-right text-xs tabular-nums text-gray-400">{length || '—'}</span>
      </Link>
      {home ? (
        <Link
          to={home.to}
          state={home.state}
          aria-label="Show this listening session on Home"
          title="Show this listening session on Home"
          className="shrink-0 rounded p-1 text-gray-400 hover:text-pink-600 dark:hover:text-pink-400"
        >
          <Home size={13} />
        </Link>
      ) : (
        <span className="w-[21px] shrink-0" />
      )}
    </li>
  );
}

/** The filter as the period picker models it, read from the URL. */
interface Period {
  mode: PeriodMode;
  month: string;
  week: string;
}

function Plays({ songKey, from, to, label, onClear }: { songKey: string; from: string; to: string; label: string | null; onClear: () => void }) {
  const location = useLocation();
  const { rows, total, loading, loadingMore, error, loadMore } = usePagedLibrary<SongPlay>(
    (offset, limit) => music.songPlays(songKey, { limit: limit ?? PAGE_SIZE, from: from || undefined, to: to || undefined, ...(offset ? { offset } : {}) }),
    [songKey, from, to],
    { snapshotKey: `${location.key}|${songKey}|${from}|${to}` },
  );
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          {label ? `Plays · ${label}` : 'Every play'}
          {!loading && <span className="font-normal text-gray-500"> ({total.toLocaleString()})</span>}
          {loading && <Loader2 size={14} className="ml-2 inline animate-spin text-gray-400" />}
        </h2>
        {label && (
          <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline">
            <X size={12} /> Show every play
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-500">Couldn't load the plays.</p>}
      {!loading && !error && rows.length === 0 && <p className="py-3 text-sm text-gray-500">No plays in this period.</p>}
      <ol className={`divide-y divide-gray-100 dark:divide-gray-800 ${loading ? 'opacity-60' : ''}`} aria-label="Plays">
        {rows.map((p) => (
          <PlayRow key={p.id} play={p} />
        ))}
      </ol>
      <div className="py-2">
        <PagingFooter shown={rows.length} total={total} loadingMore={loadingMore} onMore={loadMore} />
      </div>
    </div>
  );
}

export default function SongPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const songKey = params.get('key') ?? '';
  const [song, setSong] = useState<(SongDetail & { key: string }) | null>(null);
  const [error, setError] = useState(false);
  usePageTitle(song ? `Song: ${song.name}` : 'Song');

  useEffect(() => {
    if (!songKey) return;
    let cancelled = false;
    setError(false);
    music
      .song(songKey)
      .then((s) => !cancelled && setSong({ ...s, key: songKey }))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [songKey]);

  const current = song?.key === songKey ? song : null;
  useScrollRestoration(current != null || error);

  const lastDay = current?.daily[current.daily.length - 1]?.date ?? null;
  const bucket: Bucket = BUCKETS.includes(params.get('bucket') as Bucket) ? (params.get('bucket') as Bucket) : 'month';
  const period: Period = useMemo(() => {
    const month = params.get('month');
    const week = params.get('week');
    return {
      mode: parsePeriodParam(params.get('period')) ?? 'all',
      // Without one in the URL, the picker starts where the song was last played.
      month: isValidMonthParam(month) ? month : (lastDay?.slice(0, 7) ?? new Date().toISOString().slice(0, 7)),
      week: isValidDateParam(week) ? week : lastDay ? bucketEnd(bucketStart(lastDay, 'week'), 'week') : new Date().toISOString().slice(0, 10),
    };
  }, [params, lastDay]);
  const range = period.mode === 'all' ? null : getPeriodDateRange(period.month, period.mode, period.week);
  const rangeLabel = period.mode === 'all' ? null : getPeriodRangeLabel(period.month, period.mode, period.week);

  /** Change the chart's grouping or the period, keeping this one history entry. */
  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams],
  );
  const setPeriod = (mode: PeriodMode, month = period.month, week = period.week) =>
    update(mode === 'all' ? { period: null, month: null, week: null } : { period: mode, month, week: mode === 'weekly' ? week : null });

  const selectBar = (b: BucketCount) => {
    if (bucket === 'week') setPeriod('weekly', b.end.slice(0, 7), b.end);
    else if (bucket === 'month') setPeriod('single', b.start.slice(0, 7));
    else setPeriod('twelve', `${b.start.slice(0, 4)}-12`);
  };

  // A month (or a week, shown within its month) can be narrowed to one of its weeks.
  const weekMonth = period.mode === 'single' ? period.month : period.mode === 'weekly' ? period.week.slice(0, 7) : null;
  const weeks = current && weekMonth ? weeksOfMonth(current.daily, weekMonth) : [];

  if (!songKey) {
    return (
      <div className="space-y-4">
        <BackButton />
        <p className="text-sm text-gray-500">No song was given.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BackButton />
      {error && <p className="text-sm text-red-500">Couldn't load this song.</p>}
      {!current && !error && <Loader2 size={20} className="animate-spin text-primary-600" />}
      {current && (
        <>
          <header className="flex items-start gap-4">
            {current.art_id && (
              <Link to={albumPath({ albumRef: current.album_ref, artId: current.art_id })} aria-label="Show album" className="shrink-0">
                <img src={albumArtUrl(current.art_id)} alt="" width={96} height={96} className="h-20 w-20 rounded-lg object-cover shadow sm:h-24 sm:w-24" />
              </Link>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {current.name}
                <ListBadge itemKey={songItemKey(songKey)} size={14} />
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                <ArtistLinks artists={current.artists} />
              </p>
              {current.albums.length > 0 && (
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {current.albums.length === 1 ? 'From ' : 'On '}
                  {current.albums.map((a, i) => (
                    <span key={a.album_ref}>
                      {i > 0 && ', '}
                      <AlbumLink albumRef={a.album_ref}>{a.album ?? UNKNOWN_ALBUM}</AlbumLink>
                      {current.albums.length > 1 && <span className="tabular-nums"> ({a.plays})</span>}
                    </span>
                  ))}
                </p>
              )}
              <p className="mt-1 text-sm">
                <span className="font-medium text-pink-700 dark:text-pink-300">
                  {current.plays.toLocaleString()} play{current.plays === 1 ? '' : 's'}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {current.listened_seconds > 0 && ` · ${formatDuration(current.listened_seconds)} listened`}
                  {` · first ${formatDay(current.first_played_at)} · last ${formatDay(current.last_played_at)}`}
                </span>
              </p>
              {current.genres.length > 0 && (
                <div className="mt-2">
                  <GenreChips genres={current.genres} />
                </div>
              )}
            </div>
          </header>

          <StreaksAndPeaks daily={current.daily} rank={current.rank} rankOf={current.songs_total} rankNoun="songs" />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ClockCard cells={current.clock} title="When you play it" emptyText="No plays yet." withTotals />
            <TiesCard scope={{ songKey }} />
          </div>

          <PlaysOverTime
            daily={current.daily}
            bucket={bucket}
            onBucketChange={(b) => update({ bucket: b === 'month' ? null : b })}
            selected={range}
            onSelect={selectBar}
          />

          <section
            aria-label="Plays"
            className="space-y-3 rounded-2xl border border-white/40 bg-white/60 p-4 shadow-sm shadow-black/3 dark:border-gray-700/40 dark:bg-gray-900/60"
          >
            <PeriodRangeSelector
              periodMode={period.mode}
              onPeriodModeChange={(mode) => setPeriod(mode)}
              year={Number(period.month.slice(0, 4))}
              onYearChange={() => undefined}
              selectedMonth={period.month}
              onSelectedMonthChange={(month) => setPeriod(period.mode === 'all' ? 'single' : period.mode, month)}
              selectedWeek={period.week}
              onSelectedWeekChange={(week) => setPeriod('weekly', week.slice(0, 7), week)}
              resetMode="all"
              resetLabel="Reset to all time"
              allTimeStartDate={formatDateKey(current.daily[0]?.date ?? '')}
              onOpenHome={range ? () => navigate(`/?from=${range.from}&to=${range.to}`) : undefined}
            />
            {weeks.length > 0 && (
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`Weeks of ${bucketLabel({ start: `${weekMonth}-01`, end: `${weekMonth}-01` }, 'month')}`}>
                <span className="mr-1 text-[11px] text-gray-500 dark:text-gray-400">Weeks:</span>
                {weeks.map((w) => {
                  const on = period.mode === 'weekly' && period.week === w.end;
                  return (
                    <button
                      key={w.start}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPeriod('weekly', w.end.slice(0, 7), w.end)}
                      className={`rounded-md px-1.5 py-0.5 text-[11px] tabular-nums transition-colors ${
                        on
                          ? 'bg-violet-500 font-semibold text-white'
                          : w.plays
                            ? 'bg-violet-50 text-violet-700 hover:bg-violet-100 dark:bg-violet-900/20 dark:text-violet-300'
                            : 'bg-gray-100 text-gray-400 hover:bg-violet-100 dark:bg-gray-800'
                      }`}
                    >
                      {bucketLabel(w, 'week', true)} · {w.plays}
                    </button>
                  );
                })}
                {period.mode === 'weekly' && (
                  <button
                    type="button"
                    onClick={() => setPeriod('single', weekMonth as string)}
                    className="ml-1 text-[11px] font-medium text-primary-600 hover:underline"
                  >
                    Whole month
                  </button>
                )}
              </div>
            )}
            <Plays songKey={songKey} from={range?.from ?? ''} to={range?.to ?? ''} label={rangeLabel} onClear={() => setPeriod('all')} />
          </section>
        </>
      )}
    </div>
  );
}
