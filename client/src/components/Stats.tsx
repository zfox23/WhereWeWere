import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin,
  CalendarDays,
  Flame,
  Trophy,
  BarChart3,
  Loader2,
} from 'lucide-react';
import { stats } from '../api/client';
import type {
  Stats as StatsType,
  Streak,
  TopVenue,
  CategoryBreakdown,
  HeatmapDay,
} from '../types';

const USER_ID = '00000000-0000-0000-0000-000000000001';

export function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <div className="flex items-center gap-2 text-gray-500 mb-1">
        <Icon size={16} />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}

function formatDateShort(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(dateStr + 'T12:00:00'));
}

export function StreakCard({ streak }: { streak: Streak }) {
  const navigate = useNavigate();

  const handleCurrentClick = () => {
    if (streak.current_streak > 0 && streak.current_streak_start && streak.current_streak_end) {
      navigate(`/?from=${streak.current_streak_start}&to=${streak.current_streak_end}`);
    }
  };

  const handleLongestClick = () => {
    if (streak.longest_streak > 0 && streak.longest_streak_start && streak.longest_streak_end) {
      navigate(`/?from=${streak.longest_streak_start}&to=${streak.longest_streak_end}`);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <Flame size={16} className="text-orange-500" />
        Streaks
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Current
          </p>
          {streak.current_streak > 0 ? (
            <button onClick={handleCurrentClick} className="text-left group">
              <p className="text-xl font-bold text-orange-600 group-hover:underline">
                {streak.current_streak} day{streak.current_streak !== 1 ? 's' : ''}
              </p>
              {streak.current_streak_start && streak.current_streak_end && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {formatDateShort(streak.current_streak_start)} — {formatDateShort(streak.current_streak_end)}
                </p>
              )}
            </button>
          ) : (
            <p className="text-xl font-bold text-orange-600">0 days</p>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Longest
          </p>
          {streak.longest_streak > 0 ? (
            <button onClick={handleLongestClick} className="text-left group">
              <p className="text-xl font-bold text-gray-900 group-hover:underline">
                {streak.longest_streak} day{streak.longest_streak !== 1 ? 's' : ''}
              </p>
              {streak.longest_streak_start && streak.longest_streak_end && (
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {formatDateShort(streak.longest_streak_start)} — {formatDateShort(streak.longest_streak_end)}
                </p>
              )}
            </button>
          ) : (
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">0 days</p>
          )}
        </div>
      </div>
      {streak.last_checkin && (
        <p className="text-xs text-gray-400 mt-3">
          Last check-in:{' '}
          {new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }).format(new Date(streak.last_checkin))}
        </p>
      )}
    </div>
  );
}

export function TopVenuesList({ venues }: { venues: TopVenue[] }) {
  const navigate = useNavigate();

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <Trophy size={16} className="text-yellow-500" />
        Top Venues
      </h3>
      {venues.length === 0 ? (
        <p className="text-sm text-gray-400">No check-ins yet.</p>
      ) : (
        <ul className="space-y-2">
          {venues.map((venue, i) => (
            <li key={venue.venue_id} className="flex items-center gap-3">
              <span className="text-sm font-bold text-gray-400 w-5 text-right">
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => navigate(`/?venue_id=${venue.venue_id}`)}
                  className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate hover:text-primary-600 hover:underline text-left"
                >
                  {venue.venue_name}
                </button>
                {venue.category_name && (
                  <p className="text-xs text-gray-500">{venue.category_name}</p>
                )}
              </div>
              <span className="text-sm font-semibold text-primary-600 shrink-0">
                {venue.checkin_count} check-in{venue.checkin_count !== 1 ? 's' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CategoryChart({ data }: { data: CategoryBreakdown[] }) {
  const navigate = useNavigate();
  const maxCount = Math.max(...data.map((d) => d.checkin_count), 1);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <BarChart3 size={16} className="text-indigo-500" />
        Categories
      </h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400">No data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {data.map((item) => (
            <button
              key={item.category_name}
              onClick={() => navigate(`/?category=${encodeURIComponent(item.category_name)}`)}
              className="block w-full text-left group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate group-hover:text-primary-600 group-hover:underline">
                  {item.category_name}
                </span>
                <span className="text-xs text-gray-500 shrink-0 ml-2">
                  {item.checkin_count} check-in{item.checkin_count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-primary-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${(item.checkin_count / maxCount) * 100}%`,
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Heatmap({ days, year, onYearChange, onDayClick }: {
  days: HeatmapDay[];
  year: number;
  onYearChange?: (year: number) => void;
  onDayClick?: (date: string) => void;
}) {
  const dayMap = new Map(days.map((d) => [d.date, d.count]));
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  // Build array of all days in the year using local dates to match server YYYY-MM-DD format
  const allDays: { date: string; count: number }[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    allDays.push({ date: dateStr, count: dayMap.get(dateStr) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  // Pad start so first week begins on Sunday
  const startDow = new Date(startDate).getDay();
  const paddedDays = [
    ...Array.from({ length: startDow }, () => null),
    ...allDays,
  ];

  // Split into weeks (columns)
  const weeks: (typeof paddedDays)[] = [];
  for (let i = 0; i < paddedDays.length; i += 7) {
    weeks.push(paddedDays.slice(i, i + 7));
  }

  const maxCount = Math.max(...allDays.map((d) => d.count), 1);

  function getColor(count: number): string {
    if (count === 0) return 'bg-gray-100 dark:bg-gray-800';
    const ratio = count / maxCount;
    if (ratio <= 0.25) return 'bg-primary-200';
    if (ratio <= 0.5) return 'bg-primary-300';
    if (ratio <= 0.75) return 'bg-primary-500';
    return 'bg-primary-700';
  }

  const monthLabels = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  const currentYear = new Date().getFullYear();

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <div className="flex items-center justify-start mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <CalendarDays size={16} className="text-green-600" />
          {year} Activity
        </h3>
        {onYearChange && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onYearChange(year - 1)}
              className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
            >
              &larr; {year - 1}
            </button>
            {year < currentYear && (
              <button
                onClick={() => onYearChange(year + 1)}
                className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
              >
                {year + 1} &rarr;
              </button>
            )}
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        {/* Month labels */}
        <div className="flex gap-[3px] mb-1 ml-0">
          {monthLabels.map((m, i) => {
            // Approximate position: each month ~4.3 weeks
            const weekIndex = Math.floor((i * 52) / 12);
            return (
              <span
                key={m}
                className="text-[10px] text-gray-400"
                style={{
                  position: 'relative',
                  left: `${weekIndex * 15}px`,
                }}
              >
                {i % 2 === 0 ? m : ''}
              </span>
            );
          })}
        </div>
        <div className="flex gap-[3px]">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {week.map((day, di) => (
                <div
                  key={di}
                  className={`w-[12px] h-[12px] rounded-sm ${
                    day ? getColor(day.count) : 'bg-transparent'
                  } ${day && day.count > 0 && onDayClick ? 'cursor-pointer hover:ring-2 hover:ring-primary-400 hover:ring-offset-1' : ''}`}
                  title={day ? `${day.date}: ${day.count} check-in${day.count !== 1 ? 's' : ''}` : ''}
                  onClick={() => {
                    if (day && day.count > 0 && onDayClick) {
                      onDayClick(day.date);
                    }
                  }}
                />
              ))}
              {/* Pad incomplete weeks at the end */}
              {week.length < 7 &&
                Array.from({ length: 7 - week.length }, (_, k) => (
                  <div key={`pad-${k}`} className="w-[12px] h-[12px]" />
                ))}
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-1 mt-2 justify-end">
          <span className="text-[10px] text-gray-400 mr-1">Less</span>
          <div className="w-[12px] h-[12px] rounded-sm bg-gray-100 dark:bg-gray-800" />
          <div className="w-[12px] h-[12px] rounded-sm bg-primary-200" />
          <div className="w-[12px] h-[12px] rounded-sm bg-primary-300" />
          <div className="w-[12px] h-[12px] rounded-sm bg-primary-500" />
          <div className="w-[12px] h-[12px] rounded-sm bg-primary-700" />
          <span className="text-[10px] text-gray-400 ml-1">More</span>
        </div>
      </div>
    </div>
  );
}

export default function StatsView() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<StatsType | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [topVenues, setTopVenues] = useState<TopVenue[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [heatmapDays, setHeatmapDays] = useState<HeatmapDay[]>([]);
  const [heatmapYear, setHeatmapYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      setLoading(true);
      try {
        const [s, st, tv, cb, hm] = await Promise.all([
          stats.summary(USER_ID),
          stats.streaks(USER_ID),
          stats.topVenues(USER_ID, 10),
          stats.categoryBreakdown(USER_ID),
          stats.heatmap(USER_ID, heatmapYear),
        ]);
        setSummary(s);
        setStreak(st);
        setTopVenues(tv);
        setCategories(cb);
        setHeatmapDays(hm);
      } catch (err) {
        console.error('Failed to load stats:', err);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  useEffect(() => {
    stats.heatmap(USER_ID, heatmapYear).then(setHeatmapDays).catch(console.error);
  }, [heatmapYear]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary grid */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard
            icon={MapPin}
            label="Check-ins"
            value={summary.total_checkins}
          />
          <StatCard
            icon={MapPin}
            label="Unique Venues"
            value={summary.unique_venues}
          />
          <StatCard
            icon={CalendarDays}
            label="Active Days"
            value={summary.days_with_checkins}
          />
        </div>
      )}

      {/* Streaks */}
      {streak && <StreakCard streak={streak} />}

      {/* Two column layout for top venues and categories */}
      <div className="grid md:grid-cols-2 gap-4">
        <TopVenuesList venues={topVenues} />
        <CategoryChart data={categories} />
      </div>

      {/* Heatmap */}
      <Heatmap
        days={heatmapDays}
        year={heatmapYear}
        onYearChange={setHeatmapYear}
        onDayClick={(date) => navigate(`/?from=${date}&to=${date}`)}
      />
    </div>
  );
}
