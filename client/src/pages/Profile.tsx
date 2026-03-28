import { useState, useEffect, useMemo } from 'react';
import {
  MapPin,
  Camera,
  CalendarDays,
  Loader2,
  Globe,
} from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { stats } from '../api/client';
import {
  StatCard,
  StreakCard,
  TopVenuesList,
  CategoryChart,
  Heatmap,
} from '../components/Stats';
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

function getHeatColor(count: number, min: number, max: number): string {
  if (max === min) return '#22c55e';
  const ratio = (count - min) / (max - min);
  const r = ratio < 0.5 ? Math.round(255 * ratio * 2) : 255;
  const g = ratio < 0.5 ? 255 : Math.round(255 * (1 - (ratio - 0.5) * 2));
  return `rgb(${r}, ${g}, 0)`;
}

function HeatmapMapInner({
  data,
  onBoundsChange,
}: {
  data: MapDataPoint[];
  onBoundsChange: (bounds: L.LatLngBounds) => void;
}) {
  const map = useMapEvents({
    moveend: () => {
      onBoundsChange(map.getBounds());
    },
  });

  useEffect(() => {
    onBoundsChange(map.getBounds());
  }, [map, onBoundsChange]);

  return null;
}

function HeatmapMap({ data }: { data: MapDataPoint[] }) {
  const [bounds, setBounds] = useState<L.LatLngBounds | null>(null);

  const visibleData = useMemo(() => {
    if (!bounds) return data;
    return data.filter((d) =>
      bounds.contains(L.latLng(d.latitude, d.longitude))
    );
  }, [data, bounds]);

  const { min, max } = useMemo(() => {
    if (visibleData.length === 0) return { min: 0, max: 1 };
    const counts = visibleData.map((d) => d.checkin_count);
    return { min: Math.min(...counts), max: Math.max(...counts) };
  }, [visibleData]);

  const center = useMemo((): [number, number] => {
    if (data.length === 0) return [40.7128, -74.006];
    const avgLat = data.reduce((s, d) => s + d.latitude, 0) / data.length;
    const avgLng = data.reduce((s, d) => s + d.longitude, 0) / data.length;
    return [avgLat, avgLng];
  }, [data]);

  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-4 pb-2">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
          <MapPin size={16} className="text-primary-600" />
          All Check-ins
        </h3>
      </div>
      <div className="h-[400px]">
        <MapContainer
          center={center}
          zoom={4}
          scrollWheelZoom
          attributionControl={false}
          className="w-full h-full"
          style={{ height: '100%' }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <HeatmapMapInner data={data} onBoundsChange={setBounds} />
          {data.map((point) => (
            <CircleMarker
              key={point.venue_id}
              center={[point.latitude, point.longitude]}
              radius={Math.max(6, Math.min(14, 6 + (point.checkin_count / Math.max(max, 1)) * 8))}
              fillColor={getHeatColor(point.checkin_count, min, max)}
              color={getHeatColor(point.checkin_count, min, max)}
              fillOpacity={0.8}
              weight={2}
              opacity={1}
            >
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold">{point.venue_name}</p>
                  <p className="text-gray-600">
                    {point.checkin_count} check-in{point.checkin_count !== 1 ? 's' : ''}
                  </p>
                  {point.dates.length > 0 && (
                    <div className="mt-1 max-h-24 overflow-y-auto">
                      {point.dates.slice(0, 10).map((d) => (
                        <p key={d} className="text-xs text-gray-400">{d}</p>
                      ))}
                      {point.dates.length > 10 && (
                        <p className="text-xs text-gray-400">
                          +{point.dates.length - 10} more
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      <div className="px-4 py-2 flex items-center gap-2 text-[10px] text-gray-400 justify-end">
        <span>Fewer</span>
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#22c55e' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#80c000' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ff0' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ff8000' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ff0000' }} />
        <span>More</span>
      </div>
    </div>
  );
}

function CountriesList({ data }: { data: CountryStats[] }) {
  if (data.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <Globe size={16} className="text-blue-500" />
        Countries
      </h3>
      <ul className="space-y-2">
        {data.map((item) => (
          <li key={item.country} className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">{item.country}</span>
            <div className="text-right">
              <span className="text-sm font-semibold text-primary-600">
                {item.checkin_count} check-in{item.checkin_count !== 1 ? 's' : ''}
              </span>
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
  const [summary, setSummary] = useState<StatsType | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [topVenues, setTopVenues] = useState<TopVenue[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [heatmapDays, setHeatmapDays] = useState<HeatmapDay[]>([]);
  const [countries, setCountries] = useState<CountryStats[]>([]);
  const [mapData, setMapData] = useState<MapDataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [s, st, tv, cb, hm, co, md] = await Promise.all([
          stats.summary(USER_ID),
          stats.streaks(USER_ID),
          stats.topVenues(USER_ID, 10),
          stats.categoryBreakdown(USER_ID),
          stats.heatmap(USER_ID, new Date().getFullYear()),
          stats.countries(USER_ID),
          stats.mapData(USER_ID),
        ]);
        setSummary(s);
        setStreak(st);
        setTopVenues(tv);
        setCategories(cb);
        setHeatmapDays(hm);
        setCountries(co);
        setMapData(md);
      } catch (err) {
        console.error('Failed to load profile data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Profile</h1>

      {/* Summary grid */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={MapPin} label="Check-ins" value={summary.total_checkins} />
          <StatCard icon={MapPin} label="Unique Venues" value={summary.unique_venues} />
          <StatCard icon={Camera} label="Photos" value={summary.total_photos} />
          <StatCard icon={CalendarDays} label="Active Days" value={summary.days_with_checkins} />
        </div>
      )}

      {/* Streaks */}
      {streak && <StreakCard streak={streak} />}

      {/* Heatmap Map */}
      <HeatmapMap data={mapData} />

      {/* Countries */}
      <CountriesList data={countries} />

      {/* Top venues and categories */}
      <div className="grid md:grid-cols-2 gap-4">
        <TopVenuesList venues={topVenues} />
        <CategoryChart data={categories} />
      </div>

      {/* Activity heatmap */}
      <Heatmap days={heatmapDays} />
    </div>
  );
}
