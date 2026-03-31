import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Star,
  Compass,
  Heart,
  Home as HomeIcon,
  Zap,
  Briefcase,
  TrendingUp,
  Hash,
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
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] overflow-hidden">
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

interface DayOfWeekData { day: string; count: number }
interface TimeOfDayData { period: string; count: number }
interface BusiestDayData { date: string; count: number }
interface CityData { city: string; country: string; checkin_count: number; unique_venues: number }
interface InsightData { title: string; description: string; icon: string }
interface ReflectionYear { year: number; years_ago: number; checkins: { id: string; venue_name: string; venue_category?: string; city?: string; country?: string; notes?: string; rating?: number; checked_in_at: string }[] }
interface AdditionalStatsData {
  avg_rating: number | null;
  rated_count: number;
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
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <Calendar size={16} className="text-violet-500" />
        Day of Week
      </h3>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.day} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-8 shrink-0">{d.day.slice(0, 3)}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
              <div
                className="bg-violet-500 h-full rounded-full transition-all"
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium text-gray-600 w-8 text-right">{d.count}</span>
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
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
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
              <p className="text-xs font-medium text-gray-700">{d.period}</p>
              <p className="text-lg font-bold text-gray-900">{pct}%</p>
              <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
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
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <CalendarDays size={16} className="text-rose-500" />
        Busiest Days
      </h3>
      <ul className="space-y-2">
        {data.map((d, i) => (
          <li key={d.date} className="flex items-center gap-3">
            <span className="text-sm font-bold text-gray-400 w-5 text-right">{i + 1}</span>
            <button
              onClick={() => navigate(`/?from=${d.date}&to=${d.date}`)}
              className="flex-1 text-left text-sm text-gray-900 hover:text-primary-600 hover:underline"
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
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <Building2 size={16} className="text-teal-500" />
        Top Cities
      </h3>
      <ul className="space-y-2">
        {data.map((d) => (
          <li key={`${d.city}-${d.country}`}>
            <div className="flex items-center justify-between mb-0.5">
              <button
                onClick={() => navigate(`/?q=${encodeURIComponent(d.city)}`)}
                className="text-sm font-medium text-gray-900 hover:text-primary-600 hover:underline text-left truncate"
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
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div className="bg-teal-500 h-full rounded-full" style={{ width: `${(d.checkin_count / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const INSIGHT_ICONS: Record<string, React.ElementType> = {
  calendar: Calendar,
  clock: Clock,
  heart: Heart,
  compass: Compass,
  home: HomeIcon,
  sun: Sun,
  briefcase: Briefcase,
  zap: Zap,
  globe: Globe,
};

function InsightsSection({ data }: { data: InsightData[] }) {
  if (data.length === 0) return null;

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <Lightbulb size={16} className="text-amber-500" />
        Insights
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.map((insight, i) => {
          const Icon = INSIGHT_ICONS[insight.icon] || Lightbulb;
          return (
            <div key={i} className="flex items-start gap-3 p-3 bg-amber-50/50 rounded-lg border border-amber-100">
              <Icon size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-gray-900">{insight.title}</p>
                <p className="text-xs text-gray-600 mt-0.5">{insight.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReflectionsSection({ data }: { data: ReflectionYear[] }) {
  if (data.length === 0) return null;

  function formatTime(dateStr: string) {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(dateStr));
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <History size={16} className="text-purple-500" />
        On This Day
      </h3>
      <div className="space-y-4">
        {data.map((year) => (
          <div key={year.year}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                {year.years_ago} year{year.years_ago !== 1 ? 's' : ''} ago
              </span>
              <span className="text-xs text-gray-400">{year.year}</span>
            </div>
            <div className="space-y-2 ml-2 border-l-2 border-purple-100 pl-3">
              {year.checkins.map((c) => (
                <div key={c.id} className="text-sm">
                  <p className="font-medium text-gray-900">{c.venue_name}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {c.venue_category && <span className="text-purple-600">{c.venue_category}</span>}
                    {c.city && <span>{c.city}{c.country ? `, ${c.country}` : ''}</span>}
                    <span>{formatTime(c.checked_in_at)}</span>
                  </div>
                  {c.notes && <p className="text-xs text-gray-600 mt-0.5 italic">"{c.notes}"</p>}
                  {c.rating && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star key={s} size={10} className={s <= c.rating! ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'} />
                      ))}
                    </div>
                  )}
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
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <TrendingUp size={16} className="text-emerald-500" />
        More Stats
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {data.avg_rating != null && (
          <div>
            <div className="flex items-center gap-1 text-gray-500 mb-0.5">
              <Star size={12} />
              <span className="text-xs font-medium uppercase tracking-wide">Avg Rating</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{data.avg_rating}</p>
            <p className="text-[10px] text-gray-400">{data.rated_count} rated check-ins</p>
          </div>
        )}
        {data.top_category && (
          <div>
            <div className="flex items-center gap-1 text-gray-500 mb-0.5">
              <Hash size={12} />
              <span className="text-xs font-medium uppercase tracking-wide">Top Category</span>
            </div>
            <p className="text-base font-bold text-gray-900">{data.top_category.name}</p>
            <p className="text-[10px] text-gray-400">{data.top_category.count} check-ins</p>
          </div>
        )}
        <div>
          <div className="flex items-center gap-1 text-gray-500 mb-0.5">
            <MapPin size={12} />
            <span className="text-xs font-medium uppercase tracking-wide">One-Timers</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{data.one_time_venues}</p>
          <p className="text-[10px] text-gray-400">venues visited once</p>
        </div>
        {data.longest_gap.days > 0 && (
          <div>
            <div className="flex items-center gap-1 text-gray-500 mb-0.5">
              <Calendar size={12} />
              <span className="text-xs font-medium uppercase tracking-wide">Longest Gap</span>
            </div>
            <p className="text-xl font-bold text-gray-900">{data.longest_gap.days} days</p>
            <p className="text-[10px] text-gray-400">{formatDate(data.longest_gap.start)} — {formatDate(data.longest_gap.end)}</p>
          </div>
        )}
        {data.first_checkin && (
          <div className="col-span-2">
            <div className="flex items-center gap-1 text-gray-500 mb-0.5">
              <Clock size={12} />
              <span className="text-xs font-medium uppercase tracking-wide">First Check-in</span>
            </div>
            <p className="text-base font-bold text-gray-900">{data.first_checkin.venue_name}</p>
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
      <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5 mb-3">
        <Globe size={16} className="text-blue-500" />
        Countries
      </h3>
      <ul className="space-y-2">
        {data.map((item) => (
          <li key={item.country} className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">{item.country}</span>
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
  const navigate = useNavigate();
  const [summary, setSummary] = useState<StatsType | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
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
  const [insights, setInsights] = useState<InsightData[]>([]);
  const [reflections, setReflections] = useState<ReflectionYear[]>([]);
  const [additionalStats, setAdditionalStats] = useState<AdditionalStatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [s, st, tv, cb, hm, co, md, dow, tod, bd, tc, ins, ref, as_] = await Promise.all([
          stats.summary(USER_ID),
          stats.streaks(USER_ID),
          stats.topVenues(USER_ID, 10),
          stats.categoryBreakdown(USER_ID),
          stats.heatmap(USER_ID, heatmapYear),
          stats.countries(USER_ID),
          stats.mapData(USER_ID),
          stats.dayOfWeek(USER_ID),
          stats.timeOfDay(USER_ID),
          stats.busiestDays(USER_ID),
          stats.topCities(USER_ID),
          stats.insights(USER_ID),
          stats.reflections(USER_ID),
          stats.additionalStats(USER_ID),
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
        setDayOfWeek(dow);
        setTimeOfDay(tod);
        setBusiestDays(bd);
        setTopCities(tc);
        setInsights(ins);
        setReflections(ref);
        setAdditionalStats(as_);
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
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Profile</h1>

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
      {streak && <StreakCard streak={streak} />}

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
      <AdditionalStats data={additionalStats} />

      {/* Countries */}
      <CountriesList data={countries} />

      {/* Insights */}
      <InsightsSection data={insights} />

      {/* Reflections — On This Day */}
      <ReflectionsSection data={reflections} />

      {/* Heatmap Map */}
      <HeatmapMap data={mapData} />
    </div>
  );
}
