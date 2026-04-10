import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Calendar,
  CalendarDays,
  Clock,
  Globe,
  Loader2,
  MapPin,
  Moon,
  MoonStarIcon,
  Sun,
  SunriseIcon,
} from 'lucide-react';
import { CircleMarker, FeatureGroup, MapContainer, Marker, Polyline, Popup as LeafletPopup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { stats } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { PeriodRangeSelector } from './PeriodRangeSelector';
import {
  CategoryChart,
  StatCard,
  TopVenuesList,
} from './Stats';
import {
  PeriodMode,
  getCurrentDateIso,
  getCurrentMonthIso,
  getPeriodDateRange,
  getPeriodRangeLabel,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
} from '../utils/periodRange';
import type {
  CategoryBreakdown,
  CountryStats,
  HeatmapDay,
  MapDataPoint,
  Stats as StatsType,
  TopVenue,
} from '../types';
import { formatDate } from '../utils/checkin';

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

interface VenueMarkerPlacement {
  venue: MapDataPoint;
  displayPosition: [number, number];
  originalPosition: [number, number];
  displaced: boolean;
}

interface DayOfWeekData { day: string; count: number }
interface TimeOfDayData { period: string; count: number }
interface BusiestDayData { date: string; count: number }
interface CityData { city: string; country: string; checkin_count: number; unique_venues: number }
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
const LIGHT_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

function getVenuePinIcon(checkinCount: number, resolvedTheme: 'light' | 'dark'): L.DivIcon {
  const badge = checkinCount > 99 ? '99+' : String(checkinCount);
  const size = checkinCount >= 25 ? 42 : checkinCount >= 10 ? 38 : 34;
  const pointerHeight = 12;
  const background = resolvedTheme === 'dark'
    ? checkinCount >= 25
      ? 'linear-gradient(135deg, #fdba74 0%, #f97316 100%)'
      : checkinCount >= 10
        ? 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)'
        : 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)'
    : checkinCount >= 25
      ? 'linear-gradient(135deg, #c2410c 0%, #f97316 100%)'
      : checkinCount >= 10
        ? 'linear-gradient(135deg, #ea580c 0%, #fb923c 100%)'
        : 'linear-gradient(135deg, #f97316 0%, #fdba74 100%)';
  const pointerColor = resolvedTheme === 'dark' ? '#f97316' : '#c2410c';

  return L.divIcon({
    className: 'venue-pin-icon',
    html: `<div style="position: relative; width: ${size}px; height: ${size + pointerHeight}px;">
      <div style="position: absolute; left: 0; top: 0; width: ${size}px; height: ${size}px; border-radius: 9999px; background: ${background}; border: 2px solid rgba(255,255,255,0.95); box-shadow: 0 8px 16px rgba(15, 23, 42, 0.22); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: ${badge.length > 2 ? 10 : 11}px; line-height: 1;">${badge}</div>
      <div style="position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: ${pointerHeight}px solid ${pointerColor};"></div>
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

function buildClusteredVenueItems(map: L.Map, data: MapDataPoint[], zoom: number, maxZoom: number): ClusteredVenueItem[] {
  if (zoom >= maxZoom) {
    return data.map((venue) => ({ kind: 'venue', venue }));
  }

  // Cluster any pins whose projected pixel coordinates fall in the same ~44 px cell.
  // 44 px matches the largest pin diameter so visually-overlapping pins always merge,
  // and this threshold applies at every zoom level without any early exit.
  const CLUSTER_CELL_PX = 44;
  const buckets = new Map<string, MapDataPoint[]>();

  for (const venue of data) {
    const point = map.project([venue.latitude, venue.longitude], zoom);
    const key = `${Math.floor(point.x / CLUSTER_CELL_PX)}:${Math.floor(point.y / CLUSTER_CELL_PX)}`;
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

function splitFormattedTimestamp(value: string): { datePart: string; timePart: string } {
  const parts = value.split(', ');
  if (parts.length >= 4) {
    return {
      datePart: parts.slice(0, 3).join(', '),
      timePart: parts.slice(3).join(', '),
    };
  }

  return { datePart: value, timePart: '' };
}

function buildMaxZoomPlacements(map: L.Map, venues: MapDataPoint[], zoom: number): VenueMarkerPlacement[] {
  const MIN_MARKER_SPACING_PX = 44;
  const placedPoints: L.Point[] = [];

  const overlaps = (candidate: L.Point): boolean => {
    return placedPoints.some((point) => candidate.distanceTo(point) < MIN_MARKER_SPACING_PX);
  };

  const findPlacementPoint = (basePoint: L.Point): L.Point => {
    if (!overlaps(basePoint)) return basePoint;

    // Search outward on a square lattice until a free marker-tip position is found.
    for (let ring = 1; ring <= 300; ring += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        for (let dy = -ring; dy <= ring; dy += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;

          const candidate = L.point(
            basePoint.x + dx * MIN_MARKER_SPACING_PX,
            basePoint.y + dy * MIN_MARKER_SPACING_PX
          );

          if (!overlaps(candidate)) {
            return candidate;
          }
        }
      }
    }

    return basePoint;
  };

  return venues.map((venue) => {
    const basePoint = map.project([venue.latitude, venue.longitude], zoom);
    const placedPoint = findPlacementPoint(basePoint);
    placedPoints.push(placedPoint);

    const placedLatLng = map.unproject(placedPoint, zoom);

    return {
      venue,
      displayPosition: [placedLatLng.lat, placedLatLng.lng],
      originalPosition: [venue.latitude, venue.longitude],
      displaced: placedPoint.distanceTo(basePoint) > 0.01,
    };
  });
}

function VenueMapMarkers({
  data,
}: {
  data: MapDataPoint[];
}) {
  const map = useMap();
  const { resolvedTheme } = useTheme();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const maxZoom = map.getMaxZoom();
  const isMaxZoom = zoom >= maxZoom;

  const items = useMemo(
    () => buildClusteredVenueItems(map, data, zoom, maxZoom),
    [data, map, zoom, maxZoom]
  );

  const markerPlacements = useMemo(() => {
    if (!isMaxZoom) return null;

    const venuesOnly = items
      .filter((item): item is Extract<ClusteredVenueItem, { kind: 'venue' }> => item.kind === 'venue')
      .map((item) => item.venue);

    return buildMaxZoomPlacements(map, venuesOnly, zoom);
  }, [isMaxZoom, items, map, zoom]);

  const placementByVenueId = useMemo(() => {
    if (!markerPlacements) return null;
    return new Map(markerPlacements.map((placement) => [placement.venue.venue_id, placement]));
  }, [markerPlacements]);

  return (
    <>
      {items.map((item) => {
        if (item.kind === 'venue') {
          const venue = item.venue;
          const placement = placementByVenueId?.get(venue.venue_id);
          const markerPosition: [number, number] = placement?.displayPosition ?? [venue.latitude, venue.longitude];
          const formattedLastVisit = venue.last_checkin_at
            ? formatDate(venue.last_checkin_at, venue.last_checkin_timezone)
            : null;
          const { datePart, timePart } = formattedLastVisit
            ? splitFormattedTimestamp(formattedLastVisit)
            : { datePart: '', timePart: '' };
          const dayFilter = venue.dates[0] || null;
          return (
            <FeatureGroup key={venue.venue_id}>
              {placement?.displaced && (
                <Polyline
                  positions={[placement.displayPosition, placement.originalPosition]}
                  pathOptions={{
                    color: resolvedTheme === 'dark' ? '#fb923c' : '#c2410c',
                    weight: 2,
                    opacity: 0.65,
                  }}
                />
              )}
              <Marker
                position={markerPosition}
                icon={getVenuePinIcon(venue.checkin_count, resolvedTheme)}
              >
                <LeafletPopup>
                  <div className="p-2 text-sm min-w-[220px] max-w-[260px] space-y-1.5 rounded-md border border-gray-200 bg-white text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
                    <button
                      type="button"
                      onClick={() => {
                        window.open(`/venues/${venue.venue_id}`, '_blank', 'noopener,noreferrer');
                      }}
                      className="text-sm text-left font-medium text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400 dark:hover:text-primary-300"
                    >
                      {venue.venue_name}
                    </button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {venue.checkin_count} check-in{venue.checkin_count !== 1 ? 's' : ''}
                    </p>
                    {formattedLastVisit && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Last visit:{' '}
                        {dayFilter ? (
                          <a
                            href={`/?from=${encodeURIComponent(dayFilter)}&to=${encodeURIComponent(dayFilter)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400 dark:hover:text-primary-300"
                          >
                            {datePart}
                          </a>
                        ) : (
                          datePart
                        )}
                        {timePart ? `, ${timePart}` : ''}
                      </p>
                    )}
                  </div>
                </LeafletPopup>
              </Marker>
            </FeatureGroup>
          );
        }

        return (
          <CircleMarker
            key={item.id}
            center={[item.latitude, item.longitude]}
            radius={getClusterRadius(item.venues.length, item.checkinCount)}
            pathOptions={{
              color: resolvedTheme === 'dark' ? '#fb923c' : '#c2410c',
              weight: 2,
              fillColor: resolvedTheme === 'dark' ? '#f97316' : '#ea580c',
              fillOpacity: 0.34,
            }}
            eventHandlers={{
              click: () => {
                const nextZoom = Math.min(map.getZoom() + 2, map.getMaxZoom());
                map.flyTo([item.latitude, item.longitude], nextZoom, { duration: 0.35 });
              },
            }}
          >
            <Tooltip direction="center" permanent className="!bg-transparent !border-0 !shadow-none !text-white !font-bold">
              <span className="text-xs">{item.venues.length}</span>
            </Tooltip>
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
  const center = useMemo((): [number, number] => {
    if (data.length === 0) return [40.7128, -74.006];
    const avgLat = data.reduce((sum, item) => sum + item.latitude, 0) / data.length;
    const avgLng = data.reduce((sum, item) => sum + item.longitude, 0) / data.length;
    return [avgLat, avgLng];
  }, [data]);
  const { resolvedTheme } = useTheme();

  if (loading) {
    return (
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] overflow-hidden">
        <div className="h-[500px] flex items-center justify-center">
          <Loader2 className="animate-spin text-primary-600" size={28} />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] overflow-hidden">
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
            <TileLayer
              key={resolvedTheme}
              attribution={TILE_ATTRIBUTION}
              url={resolvedTheme === 'dark' ? DARK_TILE_URL : LIGHT_TILE_URL}
            />
            <MapBoundsController data={data} />
            <VenueMapMarkers data={data} />
          </MapContainer>
        </div>
      )}
    </div>
  );
}

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
  const total = data.reduce((sum, d) => sum + d.count, 0) || 1;
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

export function PlacesTab() {
  const getPlacesMonthFromLocation = (): string => {
    const monthParam = new URLSearchParams(window.location.search).get('placesMonth');
    return isValidMonthParam(monthParam) ? monthParam : getCurrentMonthIso();
  };

  const getPlacesPeriodFromLocation = (): PeriodMode => {
    return parsePeriodParam(new URLSearchParams(window.location.search).get('placesPeriod')) ?? 'single';
  };

  const getPlacesWeekFromLocation = (): string => {
    const weekParam = new URLSearchParams(window.location.search).get('placesWeek');
    return isValidDateParam(weekParam) ? weekParam : getCurrentDateIso();
  };

  const [placesPeriodMode, setPlacesPeriodMode] = useState<PeriodMode>(getPlacesPeriodFromLocation);
  const [placesSelectedMonth, setPlacesSelectedMonth] = useState<string>(getPlacesMonthFromLocation);
  const [placesSelectedWeek, setPlacesSelectedWeek] = useState<string>(getPlacesWeekFromLocation);
  const [placesYear, setPlacesYear] = useState(() => parseInt(getPlacesMonthFromLocation().slice(0, 4), 10));
  const [summary, setSummary] = useState<StatsType | null>(null);
  const [topVenues, setTopVenues] = useState<TopVenue[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [countries, setCountries] = useState<CountryStats[]>([]);
  const [mapData, setMapData] = useState<MapDataPoint[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeekData[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayData[]>([]);
  const [busiestDays, setBusiestDays] = useState<BusiestDayData[]>([]);
  const [topCities, setTopCities] = useState<CityData[]>([]);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [initialPlacesLoaded, setInitialPlacesLoaded] = useState(false);
  const [earliestCheckinDate, setEarliestCheckinDate] = useState<string | null>(null);

  const placesVisibleRange = useMemo(
    () => getPeriodDateRange(placesSelectedMonth, placesPeriodMode, placesSelectedWeek),
    [placesSelectedMonth, placesPeriodMode, placesSelectedWeek]
  );
  const placesRangeLabel = useMemo(
    () => getPeriodRangeLabel(placesSelectedMonth, placesPeriodMode, placesSelectedWeek),
    [placesSelectedMonth, placesPeriodMode, placesSelectedWeek]
  );

  useEffect(() => {
    stats.earliestDates(USER_ID).then((d) => setEarliestCheckinDate(d.checkins)).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlacesLoading(true);

    Promise.all([
      stats.summary(
        USER_ID,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.topVenues(
        USER_ID,
        10,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.categoryBreakdown(
        USER_ID,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.countries(
        USER_ID,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.mapData(
        USER_ID,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.dayOfWeek(
        USER_ID,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.timeOfDay(
        USER_ID,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.busiestDays(
        USER_ID,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.topCities(
        USER_ID,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
    ])
      .then(([s, tv, cb, co, md, dow, tod, bd, tc]) => {
        if (cancelled) {
          return;
        }

        setSummary(s);
        setTopVenues(tv);
        setCategories(cb);
        setCountries(co);
        setMapData(md.map((item: MapDataPoint) => ({
          ...item,
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
        })));
        setDayOfWeek(dow);
        setTimeOfDay(tod);
        setBusiestDays(bd);
        setTopCities(tc);
      })
      .catch((err) => {
        console.error('Failed to load filtered profile data:', err);
        if (!cancelled) {
          setSummary(null);
          setTopVenues([]);
          setCategories([]);
          setCountries([]);
          setMapData([]);
          setDayOfWeek([]);
          setTimeOfDay([]);
          setBusiestDays([]);
          setTopCities([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPlacesLoading(false);
          setInitialPlacesLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [placesVisibleRange.from, placesVisibleRange.to]);

  useEffect(() => {
    const syncStateFromLocation = () => {
      const nextMonth = getPlacesMonthFromLocation();
      setPlacesSelectedMonth(nextMonth);
      setPlacesSelectedWeek(getPlacesWeekFromLocation());
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

    if (url.searchParams.get('tab') !== 'places') {
      url.searchParams.set('tab', 'places');
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
    if (url.searchParams.get('placesWeek') !== placesSelectedWeek) {
      url.searchParams.set('placesWeek', placesSelectedWeek);
      changed = true;
    }

    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [placesPeriodMode, placesSelectedMonth, placesSelectedWeek]);

  if (!initialPlacesLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <PeriodRangeSelector
          periodMode={placesPeriodMode}
          onPeriodModeChange={setPlacesPeriodMode}
          year={placesYear}
          onYearChange={setPlacesYear}
          selectedMonth={placesSelectedMonth}
          onSelectedMonthChange={setPlacesSelectedMonth}
          selectedWeek={placesSelectedWeek}
          onSelectedWeekChange={setPlacesSelectedWeek}
          allTimeStartDate={earliestCheckinDate ?? undefined}
          onOpenHome={() => {
            if (placesVisibleRange.from && placesVisibleRange.to) {
              window.open(`/?from=${placesVisibleRange.from}&to=${placesVisibleRange.to}`, '_blank', 'noopener,noreferrer');
            } else {
              window.open('/', '_blank', 'noopener,noreferrer');
            }
          }}
        />
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard icon={MapPin} label="Check-ins" value={summary.total_checkins} />
          <StatCard icon={MapPin} label="Unique Venues" value={summary.unique_venues} />
          <StatCard icon={CalendarDays} label="Active Days" value={summary.days_with_checkins} />
        </div>
      )}

      <VenuePinsMap
        data={mapData}
        loading={placesLoading}
        periodLabel={placesRangeLabel}
        range={placesVisibleRange}
      />

      <div className="grid md:grid-cols-2 gap-4">
        <TopVenuesList venues={topVenues} />
        <CategoryChart data={categories} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <DayOfWeekChart data={dayOfWeek} />
        <TimeOfDayChart data={timeOfDay} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <BusiestDays data={busiestDays} />
        <TopCities data={topCities} />
      </div>

      <CountriesList data={countries} />
    </div>
  );
}