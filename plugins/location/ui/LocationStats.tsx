/**
 * Location-specific stats widgets for the Places profile tab.
 *
 * These are location-specific (top venues, categories, day-of-week and
 * time-of-day charts, busiest days, top cities, countries), so they live with
 * the location plugin rather than the shared core. The generic `StatCard` and `Heatmap` primitives
 * are reused from the core `components/Stats` module.
 */

import { useNavigate } from 'react-router-dom';
import { Trophy, BarChart3, Building2, Calendar, CalendarDays, Clock, Globe, Moon, MoonStarIcon, Sun, SunriseIcon } from 'lucide-react';
import type { TopVenue, CategoryBreakdown, CountryStats } from '../../../client/src/types';
import { useChartColors } from '../../../client/src/hooks/useChartColors';

export function TopVenuesList({ venues }: { venues: TopVenue[] }) {
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
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
              <div className="flex-1 min-w-0 truncate">
                <a
                  href={`/venues/${venue.venue_id}`}
                  target='_blank'
                  rel='noopener noreferrer'
                  className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 hover:underline text-left"
                >
                  {venue.venue_name}
                </a>
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
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
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

export interface DayOfWeekData { day: string; count: number }
export interface TimeOfDayData { period: string; count: number }
export interface BusiestDayData { date: string; count: number }
export interface CityData { city: string; country: string; checkin_count: number; unique_venues: number }
const TIME_ICONS: Record<string, React.ElementType> = {
  Morning: SunriseIcon,
  Afternoon: Sun,
  Evening: Moon,
  Night: MoonStarIcon,
};

const TIME_COLORS: Record<string, string> = {
  Morning: 'bg-amber-400',
  Afternoon: 'bg-orange-400',
  Evening: 'bg-indigo-400',
  Night: 'bg-slate-500',
};

/** Chart palette slots for the time-of-day bars when not Classic: sun, primary, extra, cool. */
const TIME_COLOR_SLOTS: Record<string, number> = { Morning: 4, Afternoon: 0, Evening: 5, Night: 1 };


export function DayOfWeekChart({ data }: { data: DayOfWeekData[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <Calendar size={16} className="text-violet-500" />
        Day of Week
      </h3>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.day} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-8 shrink-0">{d.day.slice(0, 3)}</span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 relative overflow-hidden">
              <div
                className="bg-violet-500 h-full rounded-full transition-all"
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-8 text-right">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TimeOfDayChart({ data }: { data: TimeOfDayData[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0) || 1;
  const { colors: chartColors, palette } = useChartColors();
  // Classic keeps the original Tailwind colors; other palettes use their slots.
  const barColor = (period: string) =>
    palette === 'classic' || TIME_COLOR_SLOTS[period] === undefined ? undefined : chartColors[TIME_COLOR_SLOTS[period]];
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <Clock size={16} className="text-sky-500" />
        Time of Day
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {data.map((d) => {
          const Icon = TIME_ICONS[d.period] || Sun;
          const pct = Math.round((d.count / total) * 100);
          return (
            <div key={d.period} className="text-center">
              <Icon size={20} className="mx-auto text-gray-400 mb-1" />
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{d.period}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{pct}%</p>
              <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 mt-1">
                <div
                  className={`${barColor(d.period) ? '' : TIME_COLORS[d.period] || 'bg-gray-400'} h-full rounded-full`}
                  style={{ width: `${pct}%`, backgroundColor: barColor(d.period) }}
                />
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">{d.count} check-in{d.count !== 1 ? 's' : ''}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BusiestDays({ data }: { data: BusiestDayData[] }) {
  const navigate = useNavigate();
  if (data.length === 0) return null;

  function formatDate(dateStr: string) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      .format(new Date(dateStr + 'T12:00:00'));
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <CalendarDays size={16} className="text-rose-500" />
        Busiest Days
      </h3>
      <ul className="space-y-2">
        {data.map((d, i) => (
          <li key={d.date} className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-400 w-5 text-right">{i + 1}</span>
            <button
              onClick={() => navigate(`/?from=${d.date}&to=${d.date}`)}
              className="flex-1 text-left text-sm text-gray-900 dark:text-gray-100 hover:text-primary-600 hover:underline"
            >
              {formatDate(d.date)}
            </button>
            <span className="text-sm font-semibold text-primary-600 shrink-0">
              {d.count} check-in{d.count !== 1 ? 's' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TopCities({ data }: { data: CityData[] }) {
  const navigate = useNavigate();
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.checkin_count), 1);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <Building2 size={16} className="text-teal-500" />
        Top Cities
      </h3>
      <ul className="space-y-2">
        {data.map((d) => (
          <li key={`${d.city}-${d.country}`}>
            <div className="flex items-center justify-between mb-0.5">
              <button
                onClick={() => navigate(`/?q=${encodeURIComponent(d.city)}`)}
                className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 hover:underline text-left truncate"
              >
                {d.city}
                {d.country && <span className="text-xs text-gray-400 font-normal ml-1">{d.country}</span>}
              </button>
              <span className="text-xs text-gray-500 shrink-0 ml-2">
                {d.checkin_count} check-in{d.checkin_count !== 1 ? 's' : ''}
                <span className="text-gray-300 mx-1">&middot;</span>
                {d.unique_venues} venue{d.unique_venues !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
              <div className="bg-teal-500 h-full rounded-full" style={{ width: `${(d.checkin_count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CountriesList({ data }: { data: CountryStats[] }) {
  const navigate = useNavigate();

  if (data.length === 0) return null;

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <Globe size={16} className="text-blue-500" />
        Countries
      </h3>
      <ul className="space-y-2">
        {data.map((item) => (
          <li key={item.country} className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.country}</span>
            <div className="text-right">
              <button
                onClick={() => navigate(`/?country=${encodeURIComponent(item.country)}`)}
                className="text-sm font-semibold text-primary-600 hover:text-primary-700 hover:underline"
              >
                {item.checkin_count} check-in{item.checkin_count !== 1 ? 's' : ''}
              </button>
              <span className="text-xs text-gray-400 ml-2">
                {item.unique_venues} venue{item.unique_venues !== 1 ? 's' : ''}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
