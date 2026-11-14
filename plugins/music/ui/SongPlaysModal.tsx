/**
 * Every play of one song: a header with its totals, plays per month over its
 * whole history, and the plays themselves, newest first and paged by the
 * server. Each play opens its own page; the Home icon opens its listening
 * session on the timeline.
 *
 * Rendered in a portal, like the album details.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Home, Loader2, X } from 'lucide-react';
import { usePagedLibrary } from '../../../client/src/hooks/usePagedLibrary';
import { PagingFooter } from '../../../client/src/components/lists/PagingFooter';
import { music } from './api';
import { AlbumArt } from './AlbumArt';
import { formatClock, formatDay, formatLength, joinArtists, sourceLabel, UNKNOWN_ALBUM } from './format';
import { homeDayLink } from './homeLinks';
import { playPath } from './listTitle';
import { columnAt, scrubHandlers } from './insights/scrub';
import type { SongPlay, SongPlaysSummary } from './types';

const PAGE_SIZE = 100;

/** "2024-03" -> "Mar 2024". */
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Every month from `first` to `last` ('YYYY-MM'), inclusive. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Plays per month, zero-filled between the first and last month played. */
export function PlaysByMonthChart({ monthly }: { monthly: SongPlaysSummary['monthly'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const bars = useMemo(() => {
    if (monthly.length === 0) return [];
    const counts = new Map(monthly.map((m) => [m.month, m.plays]));
    return monthsBetween(monthly[0].month, monthly[monthly.length - 1].month).map((month) => ({
      month,
      plays: counts.get(month) ?? 0,
    }));
  }, [monthly]);
  if (bars.length === 0) return null;

  const max = Math.max(...bars.map((b) => b.plays), 1);
  const W = 600;
  const H = 64;
  const slot = W / bars.length;
  const gap = slot > 4 ? 2 : 0;
  const shown = hover != null ? bars[hover] : null;
  const scrub = scrubHandlers<SVGSVGElement, number>((e) => columnAt(e, bars.length), setHover);

  return (
    <figure className="mt-3">
      <div className="mb-1 flex items-baseline justify-between text-xs text-gray-500 dark:text-gray-400">
        <figcaption>Plays per month</figcaption>
        <span className="tabular-nums" aria-live="polite">
          {shown ? `${monthLabel(shown.month)} · ${shown.plays} play${shown.plays === 1 ? '' : 's'}` : `peak ${max}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-16 w-full"
        role="img"
        aria-label={`Plays per month from ${monthLabel(bars[0].month)} to ${monthLabel(bars[bars.length - 1].month)}`}
        {...scrub}
      >
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth={1} />
        {bars.map((b, i) => {
          const h = b.plays ? Math.max((b.plays / max) * (H - 2), 2) : 0;
          return (
            <g key={b.month}>
              {h > 0 && (
                <rect
                  x={i * slot + gap / 2}
                  y={H - h}
                  width={Math.max(slot - gap, 1)}
                  height={h}
                  className={hover === i ? 'fill-pink-600 dark:fill-pink-300' : 'fill-pink-400/80'}
                >
                  <title>{`${monthLabel(b.month)}: ${b.plays}`}</title>
                </rect>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
        <span>{monthLabel(bars[0].month)}</span>
        {bars.length > 1 && <span>{monthLabel(bars[bars.length - 1].month)}</span>}
      </div>
    </figure>
  );
}

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

export function SongPlaysModal({ songKey, onClose }: { songKey: string; onClose: () => void }) {
  const [summary, setSummary] = useState<SongPlaysSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    music
      .songPlaysSummary(songKey)
      .then((s) => !cancelled && setSummary(s))
      .catch(() => !cancelled && setSummaryError(true));
    return () => {
      cancelled = true;
    };
  }, [songKey]);

  const { rows, total, loading, loadingMore, error, loadMore } = usePagedLibrary<SongPlay>(
    (offset) => music.songPlays(songKey, { limit: PAGE_SIZE, ...(offset ? { offset } : {}) }),
    [songKey],
  );

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // An album opened from here closes first.
      if (e.key === 'Escape' && !document.querySelector('[data-album-dialog]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal
        aria-label={summary ? `Plays of ${summary.name}` : 'Plays'}
        className="relative mx-auto flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-gray-900"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 z-10 rounded-full p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X size={16} />
        </button>
        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          {summaryError && <p className="text-sm text-red-500">Couldn't load this song.</p>}
          {!summary && !summaryError && <Loader2 size={20} className="animate-spin text-primary-600" />}
          {summary && (
            <>
              <div className="flex items-start gap-3 pr-8">
                <AlbumArt artId={summary.art_id} albumRef={summary.album_ref} size={56} />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">{summary.name}</h2>
                  <p className="truncate text-sm text-gray-600 dark:text-gray-300">{joinArtists(summary.artists)}</p>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-pink-700 dark:text-pink-300">
                      {summary.plays.toLocaleString()} play{summary.plays === 1 ? '' : 's'}
                    </span>
                    {' · '}first {formatDay(summary.first_played_at)} · last {formatDay(summary.last_played_at)}
                  </p>
                </div>
              </div>
              <PlaysByMonthChart monthly={summary.monthly} />
            </>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {loading && rows.length === 0 && <Loader2 size={18} className="animate-spin text-primary-600" />}
          {error && <p className="text-sm text-red-500">Couldn't load the plays.</p>}
          <ol className="divide-y divide-gray-100 dark:divide-gray-800" aria-label="Plays">
            {rows.map((p) => (
              <PlayRow key={p.id} play={p} />
            ))}
          </ol>
          <div className="py-2">
            <PagingFooter shown={rows.length} total={total} loadingMore={loadingMore} onMore={loadMore} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
