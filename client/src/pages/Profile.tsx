import { useState, useEffect, useRef, useMemo } from 'react';
import {
  MapPin,
  Camera,
  CalendarDays,
  Loader2,
  Globe,
} from 'lucide-react';
import { MapContainer, TileLayer, useMap, useMapEvents, Popup as LeafletPopup } from 'react-leaflet';
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
      radius: 30,
      blur: 20,
      maxZoom: 17,
      minOpacity: 0.6,
      max: Math.max(...data.map((d) => d.checkin_count), 1),
      gradient: {
        0.0: '#059669',
        0.2: '#16a34a',
        0.4: '#ca8a04',
        0.6: '#ea580c',
        0.8: '#dc2626',
        1.0: '#991b1b',
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

function MapClickHandler({ data }: { data: MapDataPoint[] }) {
  const [popup, setPopup] = useState<{ latlng: L.LatLng; venues: MapDataPoint[] } | null>(null);
  const map = useMapEvents({
    click: (e) => {
      const zoom = map.getZoom();
      // Search radius in degrees, shrinks as you zoom in
      const radiusDeg = 200 / Math.pow(2, zoom);
      const nearby = data.filter((d) => {
        const dlat = d.latitude - e.latlng.lat;
        const dlng = d.longitude - e.latlng.lng;
        return Math.sqrt(dlat * dlat + dlng * dlng) <= radiusDeg;
      }).sort((a, b) => b.checkin_count - a.checkin_count).slice(0, 10);

      if (nearby.length > 0) {
        setPopup({ latlng: e.latlng, venues: nearby });
      } else {
        setPopup(null);
      }
    },
  });

  if (!popup) return null;

  return (
    <LeafletPopup position={popup.latlng} eventHandlers={{ remove: () => setPopup(null) }}>
      <div className="text-sm max-w-[240px]">
        <p className="font-semibold text-gray-700 mb-1">{popup.venues.length} venue{popup.venues.length !== 1 ? 's' : ''} nearby</p>
        <ul className="space-y-1.5 max-h-48 overflow-y-auto">
          {popup.venues.map((v) => (
            <li key={v.venue_id}>
              <p className="font-medium text-gray-900">{v.venue_name}</p>
              <p className="text-xs text-gray-500">
                {v.checkin_count} check-in{v.checkin_count !== 1 ? 's' : ''}
                {v.dates.length > 0 && ` — last ${v.dates[0]}`}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </LeafletPopup>
  );
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
        <p className="text-xs text-gray-400 mt-0.5">Click anywhere on the map to see nearby venues</p>
      </div>
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
          <HeatLayer data={data} />
          <MapClickHandler data={data} />
        </MapContainer>
      </div>
      <div className="px-4 py-2 flex items-center gap-2 text-[10px] text-gray-400 justify-end">
        <span>Fewer</span>
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#059669' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#16a34a' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ca8a04' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ea580c' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#991b1b' }} />
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
