import { useState, useEffect, useRef, useMemo } from 'react';
import {
  MapPin,
  Camera,
  CalendarDays,
  Loader2,
  Globe,
} from 'lucide-react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
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

function HeatLayer({ data }: { data: MapDataPoint[] }) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    const points: L.HeatLatLngTuple[] = data.map((d) => [
      d.latitude,
      d.longitude,
      d.checkin_count,
    ]);

    layerRef.current = L.heatLayer(points, {
      radius: 25,
      blur: 15,
      maxZoom: 17,
      max: Math.max(...data.map((d) => d.checkin_count), 1),
      gradient: {
        0.0: '#22c55e',
        0.25: '#84cc16',
        0.5: '#eab308',
        0.75: '#f97316',
        1.0: '#ef4444',
      },
    }).addTo(map);

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
    };
  }, [data, map]);

  return null;
}

function HeatmapMap({ data }: { data: MapDataPoint[] }) {
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
          <HeatLayer data={data} />
        </MapContainer>
      </div>
      <div className="px-4 py-2 flex items-center gap-2 text-[10px] text-gray-400 justify-end">
        <span>Fewer</span>
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#22c55e' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#84cc16' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#eab308' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#f97316' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ef4444' }} />
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
  const [heatmapYear, setHeatmapYear] = useState(new Date().getFullYear());
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
          stats.heatmap(USER_ID, heatmapYear),
          stats.countries(USER_ID),
          stats.mapData(USER_ID),
        ]);
        setSummary(s);
        setStreak(st);
        setTopVenues(tv);
        setCategories(cb);
        setHeatmapDays(hm);
        setCountries(co);
        setMapData(md.map((d: any) => ({
          ...d,
          latitude: Number(d.latitude),
          longitude: Number(d.longitude),
        })));
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
      <Heatmap days={heatmapDays} year={heatmapYear} onYearChange={setHeatmapYear} />
    </div>
  );
}
