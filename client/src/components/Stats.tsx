import { useState, useEffect } from 'react';
import {
  MapPin,
  Camera,
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

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <div className="flex items-center gap-2 text-gray-500 mb-1">
        <Icon size={16} />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function StreakCard({ streak }: { streak: Streak }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <Flame size={16} className="text-orange-500" />
        Streaks
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Current
          </p>
          <p className="text-xl font-bold text-orange-600">
            {streak.current_streak} day{streak.current_streak !== 1 ? 's' : ''}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">
            Longest
          </p>
          <p className="text-xl font-bold text-gray-900">
            {streak.longest_streak} day{streak.longest_streak !== 1 ? 's' : ''}
          </p>
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

function TopVenuesList({ venues }: { venues: TopVenue[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
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
                <p className="text-sm font-medium text-gray-900 truncate">
                  {venue.venue_name}
                </p>
                {venue.category_name && (
                  <p className="text-xs text-gray-500">{venue.category_name}</p>
                )}
              </div>
              <span className="text-sm font-semibold text-primary-600 shrink-0">
                {venue.checkin_count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryChart({ data }: { data: CategoryBreakdown[] }) {
  const maxCount = Math.max(...data.map((d) => d.checkin_count), 1);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <BarChart3 size={16} className="text-indigo-500" />
        Categories
      </h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400">No data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {data.map((item) => (
            <div key={item.category_name}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-medium text-gray-700 truncate">
                  {item.category_name}
                </span>
                <span className="text-xs text-gray-500 shrink-0 ml-2">
                  {item.checkin_count}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-primary-500 h-2 rounded-full transition-all"
                  style={{
                    width: `${(item.checkin_count / maxCount) * 100}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Heatmap({ days }: { days: HeatmapDay[] }) {
  const dayMap = new Map(days.map((d) => [d.date, d.count]));
  const year = new Date().getFullYear();
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  // Build array of all days in the year
  const allDays: { date: string; count: number }[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dateStr = cursor.toISOString().slice(0, 10);
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
    if (count === 0) return 'bg-gray-100';
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

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <CalendarDays size={16} className="text-green-600" />
        {year} Activity
      </h3>
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
                  }`}
                  title={day ? `${day.date}: ${day.count} check-in${day.count !== 1 ? 's' : ''}` : ''}
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
          <div className="w-[12px] h-[12px] rounded-sm bg-gray-100" />
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
  const [summary, setSummary] = useState<StatsType | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [topVenues, setTopVenues] = useState<TopVenue[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [heatmapDays, setHeatmapDays] = useState<HeatmapDay[]>([]);
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
          stats.heatmap(USER_ID, new Date().getFullYear()),
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
            icon={Camera}
            label="Photos"
            value={summary.total_photos}
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
      <Heatmap days={heatmapDays} />
    </div>
  );
}
