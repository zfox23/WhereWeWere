/**
 * Profile > Notes: headline numbers and charts for the selected period,
 * the similarity analysis, and the Note Library at the bottom.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, FileText, PenLine } from 'lucide-react';
import { PeriodRangeSelector } from '../../../client/src/components/PeriodRangeSelector';
import { StatCard } from '../../../client/src/components/Stats';
import { plugins } from '../../../client/src/plugins/api';
import {
  getCurrentDateIso,
  getCurrentMonthIso,
  getPeriodDateRange,
  type PeriodMode,
} from '../../../client/src/utils/periodRange';
import { stats as coreStats } from '../../../client/src/api/client';
import { notes, type NoteStats, type NoteTag } from './api';
import { AnalysisPanel } from './AnalysisPanel';
import { TagBreakdown, TagUsage, ThemeInsights, WritingRhythm } from './NotesCharts';
import { NoteLibrary } from './library/NoteLibrary';

const USER_ID = '00000000-0000-0000-0000-000000000001';

export function NotesTab() {
  const [periodMode, setPeriodMode] = useState<PeriodMode>('all');
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthIso);
  const [selectedWeek, setSelectedWeek] = useState(getCurrentDateIso);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [earliest, setEarliest] = useState<string | null>(null);
  const [data, setData] = useState<NoteStats | null>(null);
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [threshold, setThreshold] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Bumped when an analysis finishes: themes, the library and the web reload.
  const [refreshKey, setRefreshKey] = useState(0);

  const range = useMemo(() => getPeriodDateRange(selectedMonth, periodMode, selectedWeek), [selectedMonth, periodMode, selectedWeek]);

  useEffect(() => {
    coreStats.earliestDates(USER_ID).then((d: Record<string, string | null>) => setEarliest(d.notes ?? null)).catch(() => {});
    plugins.settings.get('notes').then((s) => {
      const t = Number(s.similarity_threshold);
      if (Number.isFinite(t) && t > 0 && t < 1) setThreshold(t);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([notes.stats(range.from || undefined, range.to || undefined), notes.tags()])
      .then(([s, t]) => {
        if (cancelled) return;
        setData(s);
        setTags(t);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load note stats'));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, refreshKey]);

  const onAnalysisFinished = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <PeriodRangeSelector
        periodMode={periodMode}
        onPeriodModeChange={setPeriodMode}
        year={year}
        onYearChange={setYear}
        selectedMonth={selectedMonth}
        onSelectedMonthChange={setSelectedMonth}
        selectedWeek={selectedWeek}
        onSelectedWeekChange={setSelectedWeek}
        resetMode="all"
        allTimeStartDate={earliest ?? undefined}
        onOpenHome={() => {
          const qs = range.from && range.to ? `?from=${range.from}&to=${range.to}` : '';
          window.open(`/${qs}`, '_blank', 'noopener,noreferrer');
        }}
      />

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard icon={FileText} label="Notes" value={data.totals.notes.toLocaleString()} />
            <StatCard icon={PenLine} label="Words" value={data.totals.words.toLocaleString()} />
            <StatCard icon={BookOpen} label="Avg words" value={data.totals.avg_words.toLocaleString()} />
            <StatCard icon={CalendarDays} label="Days written" value={data.totals.days_written.toLocaleString()} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <TagBreakdown stats={data} />
            <WritingRhythm stats={data} />
          </div>
          <TagUsage stats={data} tags={tags} />
        </>
      )}

      <AnalysisPanel onFinished={onAnalysisFinished} />

      {data && <ThemeInsights stats={data} tags={tags} />}

      <NoteLibrary refreshKey={refreshKey} similarityThreshold={threshold} />
    </div>
  );
}
