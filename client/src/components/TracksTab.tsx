import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { Clock, Gauge, Heart, Map as MapIcon, Mountain, Route, TrendingUp } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { settings, stats, tracks } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { DARK_TILE_URL, LIGHT_TILE_URL, TILE_ATTRIBUTION } from '../utils/geo';
import { PeriodRangeSelector } from './PeriodRangeSelector';
import { StatCard } from './Stats';
import {
  PeriodMode,
  getCurrentDateIso,
  getCurrentMonthIso,
  getPeriodDateRange,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
} from '../utils/periodRange';
import {
  formatDistance,
  formatDuration,
  formatSpeed,
  type DistanceUnit,
} from '../utils/geo';
import type { TrackEntry, TrackMapEntry } from '../types';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const PAGE_SIZE = 500;

const TRACK_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981',
  '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#eab308', '#65a30d',
];

function TrackInfoPopup({
  track,
  color,
  distanceUnit,
}: {
  track: TrackMapEntry;
  color: string;
  distanceUnit: DistanceUnit;
}) {
  return (
    <div className="p-2 text-sm min-w-[220px] max-w-[260px] space-y-1.5 rounded-md border border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: color }} />
        <button
          type="button"
          onClick={() => {
            window.open(`/tracks/${track.id}`, '_blank', 'noopener,noreferrer');
          }}
          className="text-sm text-left font-medium text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400 dark:hover:text-primary-300"
        >
          {track.name}
        </button>
      </div>
      {(track.activity_type || track.started_at) && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {[track.activity_type, formatTrackDate(track.started_at, track.timezone)].filter(Boolean).join(' - ')}
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">Distance: {formatDistance(track.distance_m, distanceUnit)}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">Moving time: {formatDuration(track.moving_time_s)}</p>
      {track.avg_speed_mps > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Avg speed: {formatSpeed(track.avg_speed_mps, distanceUnit)}</p>
      )}
      {track.elevation_gain_m > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">Elevation gain: {formatDistance(track.elevation_gain_m, distanceUnit)}</p>
      )}
    </div>
  );
}

function FitToAllTracks({ tracks }: { tracks: TrackMapEntry[] }) {
  const map = useMap();
  const boundsKey = tracks.map((t) => t.id).join(',');

  useEffect(() => {
    let minLat = Infinity;
    let minLng = Infinity;
    let maxLat = -Infinity;
    let maxLng = -Infinity;
    for (const track of tracks) {
      const b = track.bounds;
      if (!b) continue;
      if (b.minLat < minLat) minLat = b.minLat;
      if (b.minLng < minLng) minLng = b.minLng;
      if (b.maxLat > maxLat) maxLat = b.maxLat;
      if (b.maxLng > maxLng) maxLng = b.maxLng;
    }
    if (!Number.isFinite(minLat)) return;
    map.fitBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [40, 40] }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, map]);

  return null;
}

function TracksMap({
  tracks,
  distanceUnit,
}: {
  tracks: TrackMapEntry[];
  distanceUnit: DistanceUnit;
}) {
  const { resolvedTheme } = useTheme();

  const drawTracks = tracks.filter((t) => t.coordinates.length >= 2 && t.bounds);

  const initialCenter = useMemo<[number, number]>(() => {
    let minLat = Infinity;
    let minLng = Infinity;
    let maxLat = -Infinity;
    let maxLng = -Infinity;
    for (const track of drawTracks) {
      const b = track.bounds!;
      if (b.minLat < minLat) minLat = b.minLat;
      if (b.minLng < minLng) minLng = b.minLng;
      if (b.maxLat > maxLat) maxLat = b.maxLat;
      if (b.maxLng > maxLng) maxLng = b.maxLng;
    }
    if (!Number.isFinite(minLat)) return [39.0, -77.0];
    return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  }, [tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative z-0 w-full h-[420px] rounded-xl overflow-hidden">
      <MapContainer
        center={initialCenter}
        zoom={4}
        scrollWheelZoom
        attributionControl={false}
        className="w-full h-full"
        style={{ minHeight: '420px', height: '100%' }}
      >
        <TileLayer
          key={resolvedTheme}
          attribution={TILE_ATTRIBUTION}
          url={resolvedTheme === 'dark' ? DARK_TILE_URL : LIGHT_TILE_URL}
        />
        {drawTracks.map((track, i) => {
          const color = TRACK_COLORS[i % TRACK_COLORS.length];
          return (
            <Polyline
              key={track.id}
              positions={track.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])}
              pathOptions={{ color, weight: 4, opacity: 0.85 }}
            >
              <Popup>
                <TrackInfoPopup track={track} color={color} distanceUnit={distanceUnit} />
              </Popup>
            </Polyline>
          );
        })}
        <FitToAllTracks tracks={drawTracks} />
      </MapContainer>
    </div>
  );
}

async function listTracksInWindow(from: string | undefined, to: string | undefined): Promise<TrackEntry[]> {
  const all: TrackEntry[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page: TrackEntry[] = await tracks.list({
      user_id: USER_ID,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

function formatTrackDate(iso: string, tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: tz && tz !== 'UTC' ? tz : undefined,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

function TrackRankedList({
  title,
  items,
  emptyText,
  valueLabel,
  barValue,
}: {
  title: string;
  items: TrackEntry[];
  emptyText: string;
  valueLabel: (track: TrackEntry) => string;
  barValue?: (track: TrackEntry) => number;
}) {
  const toBarValue = barValue ?? ((track: TrackEntry) => Number(track.distance_m) || 0);
  const max = Math.max(...items.map(toBarValue), 1);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((track, idx) => (
            <li key={track.id} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 dark:text-gray-500 w-4 text-right shrink-0">
                {idx + 1}.
              </span>
              <button
                type="button"
                onClick={() => window.open(`/tracks/${track.id}`, '_blank', 'noopener,noreferrer')}
                title={`${track.name} - ${formatTrackDate(track.started_at, track.timezone)}`}
                className="text-xs text-left text-gray-700 dark:text-gray-200 hover:text-rose-600 dark:hover:text-rose-400 w-36 shrink-0 truncate"
              >
                {track.name}
              </button>
              <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-5 relative overflow-hidden">
                <div
                  className="h-full rounded-full transition-all bg-rose-500"
                  style={{ width: `${(toBarValue(track) / max) * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400 w-16 text-right shrink-0">
                {valueLabel(track)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityBreakdown({
  activities,
  distanceUnit,
}: {
  activities: { type: string; count: number; distanceM: number }[];
  distanceUnit: DistanceUnit;
}) {
  const max = Math.max(...activities.map((a) => a.count), 1);

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Activity Breakdown</h3>
      {activities.length === 0 ? (
        <p className="text-sm text-gray-400">No tracks in this period.</p>
      ) : (
        <div className="space-y-2">
          {activities.map((activity) => (
            <div key={activity.type} className="flex items-center gap-2">
              <span className="text-xs text-gray-600 dark:text-gray-300 w-24 truncate" title={activity.type}>
                {activity.type}
              </span>
              <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                <div
                  className="h-full bg-rose-500 rounded-full"
                  style={{ width: `${(activity.count / max) * 100}%` }}
                />
              </div>
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300 w-8 text-right">
                {activity.count}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 w-14 text-right">
                {formatDistance(activity.distanceM, distanceUnit)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TracksTab() {
  const getTrackMonthFromLocation = (): string => {
    const monthParam = new URLSearchParams(window.location.search).get('trackMonth');
    return isValidMonthParam(monthParam) ? monthParam : getCurrentMonthIso();
  };

  const getTrackPeriodFromLocation = (): PeriodMode => {
    return parsePeriodParam(new URLSearchParams(window.location.search).get('trackPeriod')) ?? 'single';
  };

  const getTrackWeekFromLocation = (): string => {
    const weekParam = new URLSearchParams(window.location.search).get('trackWeek');
    return isValidDateParam(weekParam) ? weekParam : getCurrentDateIso();
  };

  const [periodMode, setPeriodMode] = useState<PeriodMode>(getTrackPeriodFromLocation);
  const [selectedMonth, setSelectedMonth] = useState<string>(getTrackMonthFromLocation);
  const [selectedWeek, setSelectedWeek] = useState<string>(getTrackWeekFromLocation);
  const [year, setYear] = useState(() => parseInt(getTrackMonthFromLocation().slice(0, 4), 10));
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('metric');
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [earliestTrackDate, setEarliestTrackDate] = useState<string | null>(null);
  const [trackList, setTrackList] = useState<TrackEntry[]>([]);
  const [mapTracks, setMapTracks] = useState<TrackMapEntry[]>([]);

  useEffect(() => {
    settings
      .get()
      .then((s) => {
        if (s.distance_unit === 'metric' || s.distance_unit === 'imperial') {
          setDistanceUnit(s.distance_unit);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    stats.earliestDates(USER_ID).then((d) => setEarliestTrackDate(d.tracks)).catch(console.error);
  }, []);

  const visibleRange = useMemo(
    () => getPeriodDateRange(selectedMonth, periodMode, selectedWeek),
    [selectedMonth, periodMode, selectedWeek]
  );

  const summary = useMemo(() => {
    const count = trackList.length;
    const totalDistance = trackList.reduce((sum, t) => sum + (Number(t.distance_m) || 0), 0);
    const totalMovingS = trackList.reduce((sum, t) => sum + (Number(t.moving_time_s) || 0), 0);
    const totalElevation = trackList.reduce((sum, t) => sum + (Number(t.elevation_gain_m) || 0), 0);

    const withSpeed = trackList.filter(
      (t) => (Number(t.distance_m) || 0) > 0 && (Number(t.avg_speed_mps) || 0) > 0
    );
    const fastestAvg = withSpeed.length > 0
      ? Math.max(...withSpeed.map((t) => Number(t.avg_speed_mps) || 0))
      : 0;
    const maxSpeed = trackList.length > 0
      ? Math.max(...trackList.map((t) => Number(t.max_speed_mps) || 0))
      : 0;

    const avgHrValues = trackList
      .map((t) => t.avg_hr)
      .filter((v): v is number => v != null && Number.isFinite(Number(v)));
    const avgHr = avgHrValues.length > 0
      ? avgHrValues.reduce((sum, v) => sum + Number(v), 0) / avgHrValues.length
      : null;
    const maxHrValues = trackList
      .map((t) => t.max_hr)
      .filter((v): v is number => v != null && Number.isFinite(Number(v)));
    const maxHr = maxHrValues.length > 0 ? Math.max(...maxHrValues.map(Number)) : null;

    const longest = [...trackList]
      .sort((a, b) => (Number(b.distance_m) || 0) - (Number(a.distance_m) || 0) || b.started_at.localeCompare(a.started_at))
      .slice(0, 10);

    const fastest = [...withSpeed]
      .sort((a, b) => (Number(b.avg_speed_mps) || 0) - (Number(a.avg_speed_mps) || 0) || b.started_at.localeCompare(a.started_at))
      .slice(0, 10);

    const byActivity = new Map<string, { type: string; count: number; distanceM: number }>();
    for (const track of trackList) {
      const type = track.activity_type && track.activity_type.trim() ? track.activity_type.trim() : 'Other';
      const entry = byActivity.get(type) ?? { type, count: 0, distanceM: 0 };
      entry.count += 1;
      entry.distanceM += Number(track.distance_m) || 0;
      byActivity.set(type, entry);
    }
    const activities = [...byActivity.values()].sort(
      (a, b) => b.distanceM - a.distanceM || b.count - a.count || a.type.localeCompare(b.type)
    );

    return {
      count,
      totalDistance,
      totalMovingS,
      totalElevation,
      avgDistance: count > 0 ? totalDistance / count : 0,
      fastestAvg,
      maxSpeed,
      avgHr,
      maxHr,
      longest,
      fastest,
      activities,
    };
  }, [trackList]);

  useEffect(() => {
    let cancelled = false;

    const rangeParams = {
      user_id: USER_ID,
      ...(visibleRange.from ? { from: visibleRange.from } : {}),
      ...(visibleRange.to ? { to: visibleRange.to } : {}),
    };

    Promise.all([
      listTracksInWindow(visibleRange.from || undefined, visibleRange.to || undefined),
      tracks.mapData(rangeParams),
    ])
      .then(([listData, mapData]) => {
        if (cancelled) return;
        setTrackList(listData);
        setMapTracks(mapData);
      })
      .catch((err) => {
        console.error('Failed to load tracks:', err);
        if (cancelled) return;
        setTrackList([]);
        setMapTracks([]);
      })
      .finally(() => {
        if (!cancelled) setInitialLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [visibleRange.from, visibleRange.to]);

  useEffect(() => {
    const syncStateFromLocation = () => {
      const nextMonth = getTrackMonthFromLocation();
      setSelectedMonth(nextMonth);
      setSelectedWeek(getTrackWeekFromLocation());
      setYear(parseInt(nextMonth.slice(0, 4), 10));
      setPeriodMode(getTrackPeriodFromLocation());
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

    if (url.searchParams.get('tab') !== 'tracks') {
      url.searchParams.set('tab', 'tracks');
      changed = true;
    }
    if (url.searchParams.get('trackMonth') !== selectedMonth) {
      url.searchParams.set('trackMonth', selectedMonth);
      changed = true;
    }
    if (url.searchParams.get('trackPeriod') !== periodMode) {
      url.searchParams.set('trackPeriod', periodMode);
      changed = true;
    }
    if (url.searchParams.get('trackWeek') !== selectedWeek) {
      url.searchParams.set('trackWeek', selectedWeek);
      changed = true;
    }

    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [periodMode, selectedMonth, selectedWeek]);

  if (!initialLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Route className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <PeriodRangeSelector
          periodMode={periodMode}
          onPeriodModeChange={setPeriodMode}
          year={year}
          onYearChange={setYear}
          selectedMonth={selectedMonth}
          onSelectedMonthChange={setSelectedMonth}
          selectedWeek={selectedWeek}
          onSelectedWeekChange={setSelectedWeek}
          allTimeStartDate={earliestTrackDate ?? undefined}
          onOpenHome={() => {
            if (visibleRange.from && visibleRange.to) {
              window.open(`/?from=${visibleRange.from}&to=${visibleRange.to}`, '_blank', 'noopener,noreferrer');
            } else {
              window.open('/', '_blank', 'noopener,noreferrer');
            }
          }}
        />
      </div>

      <div className="grid grid-cols-3 gap-1.5 md:gap-3">
        <StatCard icon={Route} label="Tracks" value={summary.count} />
        <StatCard icon={MapIcon} label="Total Distance" value={formatDistance(summary.totalDistance, distanceUnit)} />
        <StatCard icon={Clock} label="Moving Time" value={formatDuration(summary.totalMovingS)} />
      </div>

      <div className="grid grid-cols-3 gap-1.5 md:gap-3">
        <StatCard icon={Mountain} label="Elevation Gain" value={formatDistance(summary.totalElevation, distanceUnit)} />
        <StatCard icon={TrendingUp} label="Avg Distance" value={formatDistance(summary.avgDistance, distanceUnit)} />
        <StatCard icon={Gauge} label="Fastest Average" value={summary.fastestAvg > 0 ? formatSpeed(summary.fastestAvg, distanceUnit) : '—'} />
      </div>

      {(summary.avgHr != null || summary.maxHr != null) && (
        <div className="grid grid-cols-2 gap-1.5 md:gap-3">
          <StatCard icon={Heart} label="Avg Heart Rate" value={summary.avgHr != null ? `${Math.round(summary.avgHr)} bpm` : '—'} />
          <StatCard icon={Heart} label="Max Heart Rate" value={summary.maxHr != null ? `${Math.round(summary.maxHr)} bpm` : '—'} />
        </div>
      )}

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">All Tracks</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Tap or click a track to see its details.</p>
        {mapTracks.some((t) => t.coordinates.length >= 2) ? (
          <TracksMap tracks={mapTracks} distanceUnit={distanceUnit} />
        ) : (
          <div className="flex items-center justify-center h-64 text-sm text-gray-400">
            No tracks in this period.
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <TrackRankedList
          title="Longest Tracks"
          items={summary.longest}
          emptyText="No tracks in this period."
          valueLabel={(track) => formatDistance(track.distance_m, distanceUnit)}
        />
        <TrackRankedList
          title="Fastest Tracks"
          items={summary.fastest}
          emptyText="No timed tracks in this period."
          valueLabel={(track) => formatSpeed(track.avg_speed_mps, distanceUnit)}
          barValue={(track) => Number(track.avg_speed_mps) || 0}
        />
        <ActivityBreakdown activities={summary.activities} distanceUnit={distanceUnit} />
      </div>
    </div>
  );
}
