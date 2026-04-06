import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  MapPin,
  CalendarDays,
  Loader2,
  Globe,
  Clock,
  Building2,
  Calendar,
  Sun,
  Lightbulb,
  History,
  Compass,
  Heart,
  Home as HomeIcon,
  Zap,
  Briefcase,
  TrendingUp,
  Hash,
  SmilePlus,
} from 'lucide-react';
import { CircleMarker, MapContainer, Marker, Popup as LeafletPopup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { stats } from '../api/client';
import { normalizeTimezoneForDisplay } from '../utils/checkin';
import { PeriodRangeSelector } from '../components/PeriodRangeSelector';
import {
  StatCard,
  StreakCard,
  TopVenuesList,
  CategoryChart,
  Heatmap,
} from '../components/Stats';
import { MoodsTab } from '../components/MoodStats';
import {
  PeriodMode,
  getCurrentMonthIso,
  getPeriodDateRange,
  getPeriodRangeLabel,
  isValidMonthParam,
  parsePeriodParam,
} from '../utils/periodRange';
import type {
  Stats as StatsType,
  Streak,
  TopVenue,
  CategoryBreakdown,
  HeatmapDay,
  CountryStats,
  MapDataPoint,
} from '../types';

const USER_ID = '00000000-0000-0000-0000-000000000001';

type ClusteredVenueItem =
  | {
      kind: 'venue';
      venue: MapDataPoint;
    }
  | {
      kind: 'cluster';
      id: string;
      latitude: number;
      longitude: number;
      checkinCount: number;
      venues: MapDataPoint[];
    };

function getVenuePinIcon(checkinCount: number): L.DivIcon {
  const badge = checkinCount > 99 ? '99+' : String(checkinCount);
  const size = checkinCount >= 25 ? 42 : checkinCount >= 10 ? 38 : 34;
  const pointerHeight = 12;
  const background = checkinCount >= 25
    ? 'linear-gradient(135deg, #b91c1c 0%, #ea580c 100%)'
    : checkinCount >= 10
      ? 'linear-gradient(135deg, #0f766e 0%, #0284c7 100%)'
      : 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)';

  return L.divIcon({
    className: 'venue-pin-icon',
    html: `<div style="position: relative; width: ${size}px; height: ${size + pointerHeight}px;">
      <div style="position: absolute; left: 0; top: 0; width: ${size}px; height: ${size}px; border-radius: 9999px; background: ${background}; border: 2px solid rgba(255,255,255,0.95); box-shadow: 0 8px 16px rgba(15, 23, 42, 0.22); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: ${badge.length > 2 ? 10 : 11}px; line-height: 1;">${badge}</div>
      <div style="position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: ${pointerHeight}px solid #1f2937;"></div>
    </div>`,
    iconSize: [size, size + pointerHeight],
    iconAnchor: [size / 2, size + pointerHeight],
    popupAnchor: [0, -(size + pointerHeight - 8)],
  });
}

function MapBoundsController({ data }: { data: MapDataPoint[] }) {
  const map = useMap();

  useEffect(() => {
    if (data.length === 0) {
      return;
    }

    if (data.length === 1) {
      map.setView([data[0].latitude, data[0].longitude], 13);
      return;
    }

    const bounds = L.latLngBounds(data.map((item) => [item.latitude, item.longitude] as [number, number]));
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2), { maxZoom: 13 });
    }
  }, [data, map]);

  return null;
}

function getClusterRadius(venueCount: number, checkinCount: number): number {
  if (venueCount >= 20 || checkinCount >= 100) return 28;
  if (venueCount >= 10 || checkinCount >= 50) return 24;
  if (venueCount >= 5 || checkinCount >= 20) return 20;
  return 16;
}

function buildClusteredVenueItems(map: L.Map, data: MapDataPoint[], zoom: number): ClusteredVenueItem[] {
  if (zoom >= 8) {
    return data.map((venue) => ({ kind: 'venue', venue }));
  }

  const cellSize = zoom <= 2 ? 160 : zoom <= 4 ? 120 : zoom <= 6 ? 92 : 76;
  const buckets = new Map<string, MapDataPoint[]>();

  for (const venue of data) {
    const point = map.project([venue.latitude, venue.longitude], zoom);
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(venue);
    } else {
      buckets.set(key, [venue]);
    }
  }

  return Array.from(buckets.entries()).map(([key, venues]) => {
    if (venues.length === 1) {
      return { kind: 'venue', venue: venues[0] };
    }

    const totalCheckins = venues.reduce((sum, venue) => sum + venue.checkin_count, 0);
    const weightedLat = venues.reduce((sum, venue) => sum + (venue.latitude * venue.checkin_count), 0) / totalCheckins;
    const weightedLng = venues.reduce((sum, venue) => sum + (venue.longitude * venue.checkin_count), 0) / totalCheckins;

    return {
      kind: 'cluster',
      id: key,
      latitude: weightedLat,
      longitude: weightedLng,
      checkinCount: totalCheckins,
      venues: [...venues].sort((a, b) => b.checkin_count - a.checkin_count),
    };
  });
}

function VenueMapMarkers({
  data,
  range,
}: {
  data: MapDataPoint[];
  range: { from: string; to: string };
}) {
  const navigate = useNavigate();
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const items = useMemo(() => buildClusteredVenueItems(map, data, zoom), [data, map, zoom]);

  return (
    <>
      {items.map((item) => {
        if (item.kind === 'venue') {
          const venue = item.venue;
          return (
            <Marker
              key={venue.venue_id}
              position={[venue.latitude, venue.longitude]}
              icon={getVenuePinIcon(venue.checkin_count)}
            >
              <LeafletPopup>
                <div className="text-sm min-w-[220px] max-w-[260px]">
                  <p className="font-semibold text-gray-900">{venue.venue_name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {venue.checkin_count} check-in{venue.checkin_count !== 1 ? 's' : ''}
                  </p>
                  {venue.dates.length > 0 && (
                    <p className="text-xs text-gray-500">Last visit {venue.dates[0]}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const params = new URLSearchParams({ venue_id: venue.venue_id });
                      if (range.from && range.to) {
                        params.set('from', range.from);
                        params.set('to', range.to);
                      }
                      navigate(`/?${params.toString()}`);
                    }}
                    className="mt-3 text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline"
                  >
                    Open matching check-ins
                  </button>
                </div>
              </LeafletPopup>
            </Marker>
          );
        }

        const topVenues = item.venues.slice(0, 5);
        const hiddenVenueCount = item.venues.length - topVenues.length;
        return (
          <CircleMarker
            key={item.id}
            center={[item.latitude, item.longitude]}
            radius={getClusterRadius(item.venues.length, item.checkinCount)}
            pathOptions={{
              color: '#0f766e',
              weight: 2,
              fillColor: '#14b8a6',
              fillOpacity: 0.34,
            }}
            eventHandlers={{
              click: () => {
                const nextZoom = Math.min(map.getZoom() + 2, 10);
                map.flyTo([item.latitude, item.longitude], nextZoom, { duration: 0.35 });
              },
            }}
          >
            <Tooltip direction="center" permanent className="!bg-transparent !border-0 !shadow-none !text-white !font-bold">
              <span className="text-xs">{item.venues.length}</span>
            </Tooltip>
            <LeafletPopup>
              <div className="text-sm min-w-[240px] max-w-[280px]">
                <p className="font-semibold text-gray-900">{item.venues.length} nearby venues</p>
                <p className="text-xs text-gray-500 mt-1">
                  {item.checkinCount} total check-in{item.checkinCount !== 1 ? 's' : ''}
                </p>
                <ul className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
                  {topVenues.map((venue) => (
                    <li key={venue.venue_id} className="text-xs text-gray-600">
                      <span className="font-medium text-gray-900">{venue.venue_name}</span>
                      <span className="text-gray-500"> · {venue.checkin_count}</span>
                    </li>
                  ))}
                </ul>
                {hiddenVenueCount > 0 && (
                  <p className="text-xs text-gray-400 mt-2">+{hiddenVenueCount} more venue{hiddenVenueCount !== 1 ? 's' : ''}</p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const nextZoom = Math.min(map.getZoom() + 2, 10);
                    map.flyTo([item.latitude, item.longitude], nextZoom, { duration: 0.35 });
                  }}
                  className="mt-3 text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline"
                >
                  Zoom in
                </button>
              </div>
            </LeafletPopup>
          </CircleMarker>
        );
      })}
    </>
  );
}

function VenuePinsMap({
  data,
  loading,
  periodLabel,
  range,
}: {
  data: MapDataPoint[];
  loading: boolean;
  periodLabel: string;
  range: { from: string; to: string };
}) {
  const navigate = useNavigate();
  const center = useMemo((): [number, number] => {
    if (data.length === 0) return [40.7128, -74.006];
    const avgLat = data.reduce((sum, item) => sum + item.latitude, 0) / data.length;
    const avgLng = data.reduce((sum, item) => sum + item.longitude, 0) / data.length;
    return [avgLat, avgLng];
  }, [data]);

  const subtitle = range.from && range.to
    ? `${periodLabel} • ${data.length} venue${data.length !== 1 ? 's' : ''}`
    : `All available data • ${data.length} venue${data.length !== 1 ? 's' : ''}`;

  if (loading) {
    return (
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] overflow-hidden">
        <div className="p-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
            <MapPin size={16} className="text-primary-600" />
            Venue Check-ins
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">Loading venues for the selected period</p>
        </div>
        <div className="h-[500px] flex items-center justify-center">
          <Loader2 className="animate-spin text-primary-600" size={28} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] overflow-hidden">
      <div className="p-4 pb-2">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <MapPin size={16} className="text-primary-600" />
          Venue Check-ins
        </h3>
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      {data.length === 0 ? (
        <div className="h-[280px] px-6 py-10 flex items-center justify-center text-center text-sm text-gray-400">
          No venue check-ins in this time period.
        </div>
      ) : (
        <div className="h-[500px]">
          <MapContainer
            center={center}
            zoom={4}
            scrollWheelZoom
            attributionControl={false}
            className="w-full h-full"
            style={{ height: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapBoundsController data={data} />
            <VenueMapMarkers data={data} range={range} />
          </MapContainer>
        </div>
      )}
    </div>
  );
}

interface DayOfWeekData { day: string; count: number }
interface TimeOfDayData { period: string; count: number }
interface BusiestDayData { date: string; count: number }
interface CityData { city: string; country: string; checkin_count: number; unique_venues: number }
interface InsightData { title: string; description: string; icon: string }
interface ReflectionYear { year: number; years_ago: number; checkins: { id: string; venue_id: string; venue_name: string; venue_category?: string; city?: string; country?: string; notes?: string; checked_in_at: string; venue_timezone?: string | null }[] }
interface AdditionalStatsData {
  top_category: { name: string; count: number } | null;
  longest_gap: { days: number; start: string; end: string };
  one_time_venues: number;
  first_checkin: { venue_name: string; checked_in_at: string } | null;
}

const TIME_ICONS: Record<string, React.ElementType> = { Morning: Sun, Afternoon: Sun, Evening: Clock, Night: Clock };
const TIME_COLORS: Record<string, string> = {
  Morning: 'bg-amber-400',
  Afternoon: 'bg-orange-400',
  Evening: 'bg-indigo-400',
  Night: 'bg-slate-500',
};

function DayOfWeekChart({ data }: { data: DayOfWeekData[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
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

function TimeOfDayChart({ data }: { data: TimeOfDayData[] }) {
  const total = data.reduce((s, d) => s + d.count, 0) || 1;
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
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
                <div className={`${TIME_COLORS[d.period] || 'bg-gray-400'} h-full rounded-full`} style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">{d.count} check-in{d.count !== 1 ? 's' : ''}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BusiestDays({ data }: { data: BusiestDayData[] }) {
  const navigate = useNavigate();
  if (data.length === 0) return null;

  function formatDate(dateStr: string) {
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      .format(new Date(dateStr + 'T12:00:00'));
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
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

function TopCities({ data }: { data: CityData[] }) {
  const navigate = useNavigate();
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.checkin_count), 1);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
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

function ReflectionsSection({ data }: { data: ReflectionYear[] }) {
  const navigate = useNavigate();
  if (data.length === 0) return null;

  function formatTime(dateStr: string, timeZone?: string | null) {
    const displayTimeZone = normalizeTimezoneForDisplay(timeZone);
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
    }).format(new Date(dateStr));
  }

  function handleYearClick(checkins: ReflectionYear['checkins']) {
    if (checkins.length === 0) return;
    const date = checkins[0].checked_in_at.slice(0, 10);
    navigate(`/?from=${date}&to=${date}`);
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <History size={16} className="text-purple-500" />
        On This Day
      </h3>
      <div className="space-y-4">
        {data.map((year) => (
          <div key={year.year}>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => handleYearClick(year.checkins)}
                className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
              >
                {year.years_ago} year{year.years_ago !== 1 ? 's' : ''} ago
              </button>
              <span className="text-xs text-gray-400">{year.year}</span>
            </div>
            <div className="space-y-2 ml-2 border-l-2 border-purple-100 dark:border-purple-800/40 pl-3">
              {year.checkins.map((c) => (
                <div key={c.id} className="text-sm">
                  <Link to={`/venues/${c.venue_id}`} className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">{c.venue_name}</Link>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    {c.venue_category && <span className="text-purple-600 dark:text-purple-400">{c.venue_category}</span>}
                    {c.city && <span>{c.city}{c.country ? `, ${c.country}` : ''}</span>}
                    <span>{formatTime(c.checked_in_at, c.venue_timezone)}</span>
                  </div>
                  {c.notes && <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5 italic">"{c.notes}"</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdditionalStats({ data }: { data: AdditionalStatsData | null }) {
  if (!data) return null;

  function formatDate(dateStr: string) {
    if (!dateStr) return '';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dateStr + 'T12:00:00'));
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <TrendingUp size={16} className="text-emerald-500" />
        More Stats
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {data.top_category && (
          <div>
            <div className="flex items-center gap-1 text-gray-500 mb-0.5">
              <Hash size={12} />
              <span className="text-xs font-medium uppercase tracking-wide">Top Category</span>
            </div>
            <p className="text-base font-bold text-gray-900 dark:text-gray-100">{data.top_category.name}</p>
            <p className="text-[10px] text-gray-400">{data.top_category.count} check-ins</p>
          </div>
        )}
        <div>
          <div className="flex items-center gap-1 text-gray-500 mb-0.5">
            <MapPin size={12} />
            <span className="text-xs font-medium uppercase tracking-wide">One-Timers</span>
          </div>
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{data.one_time_venues}</p>
          <p className="text-[10px] text-gray-400">venues visited once</p>
        </div>
        {data.longest_gap.days > 0 && (
          <div>
            <div className="flex items-center gap-1 text-gray-500 mb-0.5">
              <Calendar size={12} />
              <span className="text-xs font-medium uppercase tracking-wide">Longest Gap</span>
            </div>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{data.longest_gap.days} days</p>
            <p className="text-[10px] text-gray-400">{formatDate(data.longest_gap.start)} — {formatDate(data.longest_gap.end)}</p>
          </div>
        )}
        {data.first_checkin && (
          <div className="col-span-2">
            <div className="flex items-center gap-1 text-gray-500 mb-0.5">
              <Clock size={12} />
              <span className="text-xs font-medium uppercase tracking-wide">First Check-in</span>
            </div>
            <p className="text-base font-bold text-gray-900 dark:text-gray-100">{data.first_checkin.venue_name}</p>
            <p className="text-[10px] text-gray-400">
              {new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(data.first_checkin.checked_in_at))}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function CountriesList({ data }: { data: CountryStats[] }) {
  const navigate = useNavigate();

  if (data.length === 0) return null;

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
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

export default function Profile() {
  type ProfileTab = 'places' | 'moods';

  const isProfileTab = (value: string | null): value is ProfileTab => {
    return value === 'places' || value === 'moods';
  };

  const getTabFromLocation = (): ProfileTab => {
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    return isProfileTab(tabParam) ? tabParam : 'places';
  };

  const getPlacesMonthFromLocation = (): string => {
    const monthParam = new URLSearchParams(window.location.search).get('placesMonth');
    return isValidMonthParam(monthParam) ? monthParam : getCurrentMonthIso();
  };

  const getPlacesPeriodFromLocation = (): PeriodMode => {
    return parsePeriodParam(new URLSearchParams(window.location.search).get('placesPeriod')) ?? 'single';
  };

  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ProfileTab>(getTabFromLocation);
  const [placesPeriodMode, setPlacesPeriodMode] = useState<PeriodMode>(getPlacesPeriodFromLocation);
  const [placesSelectedMonth, setPlacesSelectedMonth] = useState<string>(getPlacesMonthFromLocation);
  const [placesYear, setPlacesYear] = useState(() => parseInt(getPlacesMonthFromLocation().slice(0, 4), 10));
  const [summary, setSummary] = useState<StatsType | null>(null);
  // const [streak, setStreak] = useState<Streak | null>(null);
  const [topVenues, setTopVenues] = useState<TopVenue[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [heatmapDays, setHeatmapDays] = useState<HeatmapDay[]>([]);
  const [heatmapYear, setHeatmapYear] = useState(new Date().getFullYear());
  const [countries, setCountries] = useState<CountryStats[]>([]);
  const [mapData, setMapData] = useState<MapDataPoint[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeekData[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayData[]>([]);
  const [busiestDays, setBusiestDays] = useState<BusiestDayData[]>([]);
  const [topCities, setTopCities] = useState<CityData[]>([]);
  // const [insights, setInsights] = useState<InsightData[]>([]);
  const [reflections, setReflections] = useState<ReflectionYear[]>([]);
  // const [additionalStats, setAdditionalStats] = useState<AdditionalStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(true);

  const placesVisibleRange = useMemo(
    () => getPeriodDateRange(placesSelectedMonth, placesPeriodMode),
    [placesSelectedMonth, placesPeriodMode]
  );
  const placesRangeLabel = useMemo(
    () => getPeriodRangeLabel(placesSelectedMonth, placesPeriodMode),
    [placesSelectedMonth, placesPeriodMode]
  );

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [s, tv, cb, hm, co, dow, tod, bd, tc, ref] = await Promise.all([
          stats.summary(USER_ID),
          // stats.streaks(USER_ID),
          stats.topVenues(USER_ID, 10),
          stats.categoryBreakdown(USER_ID),
          stats.heatmap(USER_ID, heatmapYear),
          stats.countries(USER_ID),
          stats.dayOfWeek(USER_ID),
          stats.timeOfDay(USER_ID),
          stats.busiestDays(USER_ID),
          stats.topCities(USER_ID),
          // stats.insights(USER_ID),
          stats.reflections(USER_ID),
          // stats.additionalStats(USER_ID),
        ]);
        setSummary(s);
        // setStreak(st);
        setTopVenues(tv);
        setCategories(cb);
        setHeatmapDays(hm);
        setCountries(co);
        setDayOfWeek(dow);
        setTimeOfDay(tod);
        setBusiestDays(bd);
        setTopCities(tc);
        // setInsights(ins);
        setReflections(ref);
        // setAdditionalStats(as_);
      } catch (err) {
        console.error('Failed to load profile data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    stats.heatmap(USER_ID, heatmapYear).then(setHeatmapDays).catch(console.error);
  }, [heatmapYear]);

  useEffect(() => {
    let cancelled = false;
    setMapLoading(true);

    stats.mapData(
      USER_ID,
      placesVisibleRange.from || undefined,
      placesVisibleRange.to || undefined
    )
      .then((data) => {
        if (cancelled) {
          return;
        }
        setMapData(data.map((item: any) => ({
          ...item,
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
        })));
      })
      .catch((err) => {
        console.error('Failed to load venue map data:', err);
        if (!cancelled) {
          setMapData([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMapLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [placesVisibleRange.from, placesVisibleRange.to]);

  useEffect(() => {
    const syncStateFromLocation = () => {
      setActiveTab(getTabFromLocation());
      const nextMonth = getPlacesMonthFromLocation();
      setPlacesSelectedMonth(nextMonth);
      setPlacesYear(parseInt(nextMonth.slice(0, 4), 10));
      setPlacesPeriodMode(getPlacesPeriodFromLocation());
    };

    syncStateFromLocation();
    window.addEventListener('popstate', syncStateFromLocation);
    window.addEventListener('hashchange', syncStateFromLocation);

    return () => {
      window.removeEventListener('popstate', syncStateFromLocation);
      window.removeEventListener('hashchange', syncStateFromLocation);
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;

    if (url.searchParams.get('tab') !== activeTab) {
      url.searchParams.set('tab', activeTab);
      changed = true;
    }
    if (url.searchParams.get('placesMonth') !== placesSelectedMonth) {
      url.searchParams.set('placesMonth', placesSelectedMonth);
      changed = true;
    }
    if (url.searchParams.get('placesPeriod') !== placesPeriodMode) {
      url.searchParams.set('placesPeriod', placesPeriodMode);
      changed = true;
    }

    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [activeTab, placesPeriodMode, placesSelectedMonth]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Profile</h1>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('places')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'places'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          <MapPin size={14} />
          Places
        </button>
        <button
          onClick={() => setActiveTab('moods')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'moods'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          <SmilePlus size={14} />
          Moods
        </button>
      </div>

      {activeTab === 'moods' && <MoodsTab />}

      {activeTab === 'places' && (
        <>
      {/* Summary grid */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard icon={MapPin} label="Check-ins" value={summary.total_checkins} />
          <StatCard icon={MapPin} label="Unique Venues" value={summary.unique_venues} />
          <StatCard icon={CalendarDays} label="Active Days" value={summary.days_with_checkins} />
        </div>
      )}

      {/* Activity heatmap */}
      <Heatmap
        days={heatmapDays}
        year={heatmapYear}
        onYearChange={setHeatmapYear}
        onDayClick={(date) => navigate(`/?from=${date}&to=${date}`)}
      />

      {/* Streaks */}
      {/* {streak && <StreakCard streak={streak} />} */}

      {/* Top venues and categories */}
      <div className="grid md:grid-cols-2 gap-4">
        <TopVenuesList venues={topVenues} />
        <CategoryChart data={categories} />
      </div>

      {/* Day of week and time of day */}
      <div className="grid md:grid-cols-2 gap-4">
        <DayOfWeekChart data={dayOfWeek} />
        <TimeOfDayChart data={timeOfDay} />
      </div>

      {/* Busiest days and top cities */}
      <div className="grid md:grid-cols-2 gap-4">
        <BusiestDays data={busiestDays} />
        <TopCities data={topCities} />
      </div>

      {/* Additional Stats */}
      {/* <AdditionalStats data={additionalStats} /> */}

      {/* Countries */}
      <CountriesList data={countries} />

      {/* Insights */}
      {/* <InsightsSection data={insights} /> */}

      {/* Reflections — On This Day */}
      <ReflectionsSection data={reflections} />

      {/* Heatmap Map */}
      <div className="space-y-3">
        <PeriodRangeSelector
          periodMode={placesPeriodMode}
          onPeriodModeChange={setPlacesPeriodMode}
          year={placesYear}
          onYearChange={setPlacesYear}
          selectedMonth={placesSelectedMonth}
          onSelectedMonthChange={setPlacesSelectedMonth}
        />
        <VenuePinsMap
          data={mapData}
          loading={mapLoading}
          periodLabel={placesRangeLabel}
          range={placesVisibleRange}
        />
      </div>
        </>
      )}
    </div>
  );
}
