/**
 * A year of listening as a calendar heatmap (plays per local day), with
 * listening days in the year and streaks over the whole history. Clicking a
 * day opens it on Home.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { Heatmap } from '../../../../client/src/components/Stats';
import { localDateKey } from '../../../../client/src/utils/checkin';
import { music } from '../api';
import type { DailyListening } from '../types';
import { ChartCard, MiniStat } from './ChartCard';

const days = (n: number) => `${n.toLocaleString()} day${n === 1 ? '' : 's'}`;

export function ListeningCalendar({ defaultYear }: { defaultYear: number }) {
  const [year, setYear] = useState(defaultYear);
  const [data, setData] = useState<DailyListening | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  // A new period on the Overview moves the calendar to its year.
  useEffect(() => setYear(defaultYear), [defaultYear]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    music
      .dailyListening(year, localDateKey(new Date().toISOString()))
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
  }, [year]);

  return (
    <ChartCard title="Listening calendar" icon={CalendarDays} loading={loading}>
      {error ? (
        <p className="text-xs text-red-500">Couldn't load the calendar.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-6">
            <MiniStat label={`Listening days in ${year}`} value={data ? data.listening_days.toLocaleString() : '—'} />
            <MiniStat label="Current streak" value={data ? days(data.current_streak) : '—'} />
            <MiniStat label="Longest streak" value={data ? days(data.longest_streak) : '—'} />
          </div>
          <Heatmap
            days={(data?.days ?? []).map((d) => ({ date: d.date, count: d.plays }))}
            year={year}
            onYearChange={setYear}
            onDayClick={(date) => navigate({ pathname: '/', search: `?from=${date}&to=${date}` })}
            showTitleIcon={false}
            title={String(year)}
            unit="play"
          />
        </>
      )}
    </ChartCard>
  );
}
