/**
 * Streaks and peaks for a song or artist, from its plays per local day: days
 * played, the longest run of days in a row, the busiest day, week and month,
 * the longest break, and where it ranks in the library.
 */

import { useMemo, type ReactNode } from 'react';
import { Flame } from 'lucide-react';
import { formatDateKey } from '../format';
import type { DayCount } from '../types';
import { ChartCard } from './ChartCard';
import { bucketLabel, highlights } from './timeline';

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">{value}</div>
      {detail && <div className="truncate text-xs text-gray-500 dark:text-gray-400">{detail}</div>}
    </div>
  );
}

export function StreaksAndPeaks({
  daily,
  rank,
  rankOf,
  rankNoun,
}: {
  daily: DayCount[];
  rank: number;
  rankOf: number;
  /** "songs" or "artists". */
  rankNoun: string;
}) {
  const h = useMemo(() => highlights(daily), [daily]);
  const range = (a: string, b: string) => (a === b ? formatDateKey(a) : `${formatDateKey(a)} – ${formatDateKey(b)}`);
  return (
    <ChartCard title="Streaks and peaks" icon={Flame}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Library rank" value={`#${rank.toLocaleString()}`} detail={`of ${rankOf.toLocaleString()} ${rankNoun}`} />
        <Stat label="Days played" value={h.daysPlayed.toLocaleString()} />
        <Stat
          label="Longest streak"
          value={h.longestStreak ? plural(h.longestStreak.days, 'day') : '—'}
          detail={h.longestStreak && h.longestStreak.days > 1 ? range(h.longestStreak.start, h.longestStreak.end) : undefined}
        />
        <Stat
          label="Busiest day"
          value={h.busiestDay ? plural(h.busiestDay.plays, 'play') : '—'}
          detail={h.busiestDay ? formatDateKey(h.busiestDay.date) : undefined}
        />
        <Stat
          label="Busiest week"
          value={h.busiestWeek ? plural(h.busiestWeek.plays, 'play') : '—'}
          detail={h.busiestWeek ? bucketLabel(h.busiestWeek, 'week') : undefined}
        />
        <Stat
          label="Busiest month"
          value={h.busiestMonth ? plural(h.busiestMonth.plays, 'play') : '—'}
          detail={h.busiestMonth ? bucketLabel(h.busiestMonth, 'month') : undefined}
        />
        <Stat
          label="Longest break"
          value={h.longestGap ? plural(h.longestGap.days, 'day') : '—'}
          detail={h.longestGap ? range(h.longestGap.after, h.longestGap.before) : undefined}
        />
      </div>
    </ChartCard>
  );
}
