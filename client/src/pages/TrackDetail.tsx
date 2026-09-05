import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Clock,
  Download,
  Flag,
  Heart,
  LineChart,
  Loader2,
  Mountain,
  Route,
  Trash2,
} from 'lucide-react';
import { MapContainer, Polyline, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { tracks, settings } from '../api/client';
import type { TrackEntry } from '../types';
import TrackGraph from '../components/TrackGraph';
import { formatDistance, formatSpeed, type DistanceUnit } from '../utils/geo';
import { DARK_TILE_URL, LIGHT_TILE_URL, TILE_ATTRIBUTION } from '../utils/geo';
import { useTheme } from '../contexts/ThemeContext';
import { normalizeTimezoneForDisplay } from '../utils/checkin';
import { usePageTitle } from '../utils/pageTitle';

// Fix Leaflet's default icon paths (broken by bundlers)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDateTime(dateStr: string, timezone?: string | null): string {
  const date = new Date(dateStr);
  const displayTimeZone = normalizeTimezoneForDisplay(timezone);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  }).format(date);
}

function formatTime(dateStr: string, timezone?: string | null): string {
  const date = new Date(dateStr);
  const displayTimeZone = normalizeTimezoneForDisplay(timezone);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  }).format(date);
}

function getLocalDateKey(dateStr: string, timezone?: string | null): string {
  const displayTimeZone = normalizeTimezoneForDisplay(timezone);
  return new Date(dateStr).toLocaleDateString('en-CA', {
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  });
}

function createPinIcon(color: string): L.DivIcon {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle cx="13" cy="13" r="8" fill="${color}" stroke="white" stroke-width="2.5"/>
      <circle cx="13" cy="13" r="3" fill="white"/>
    </svg>`
  );
  return L.divIcon({
    className: '',
    html: `<img src="data:image/svg+xml;charset=UTF-8,${svg}" alt="" aria-hidden="true" style="display:block;width:26px;height:26px;" />`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

const START_PIN = createPinIcon('#16a34a');
const END_PIN = createPinIcon('#991b1b');
const HOVER_PIN = createPinIcon('#0ea5e9');

function FitToTrack({ coordinates }: { coordinates: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates.length === 0) return;
    // Leaflet uses [lat, lng]; our coordinates are [lng, lat]
    const bounds = L.latLngBounds(coordinates.map(([lng, lat]) => [lat, lng] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [coordinates, map]);
  return null;
}

function TrackMap({
  coordinates,
  hoverPosition,
}: {
  coordinates: [number, number][];
  hoverPosition: [number, number] | null;
}) {
  const { resolvedTheme } = useTheme();
  const center = useMemo<[number, number]>(() => {
    if (coordinates.length > 0) {
      const first = coordinates[0];
      return [first[1], first[0]];
    }
    return [39.0, -77.0];
  }, [coordinates]);

  if (coordinates.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        No track geometry available.
      </div>
    );
  }

  const start: [number, number] = [coordinates[0][1], coordinates[0][0]];
  const last = coordinates[coordinates.length - 1];
  const end: [number, number] = [last[1], last[0]];

  return (
    <div className="relative z-0 w-full h-full min-h-[360px] rounded-xl overflow-hidden">
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom={true}
        attributionControl={true}
        className="w-full h-full"
        style={{ minHeight: '360px', height: '100%' }}
      >
        <TileLayer
          key={resolvedTheme}
          attribution={TILE_ATTRIBUTION}
          url={resolvedTheme === 'dark' ? DARK_TILE_URL : LIGHT_TILE_URL}
        />
        <Polyline
          positions={coordinates.map(([lng, lat]) => [lat, lng] as [number, number])}
          pathOptions={{ color: '#ef4444', weight: 5, opacity: 0.9 }}
        />
        <Marker position={start} icon={START_PIN}>
          <Popup>Start</Popup>
        </Marker>
        <Marker position={end} icon={END_PIN}>
          <Popup>End</Popup>
        </Marker>
        {hoverPosition && <Marker position={hoverPosition} icon={HOVER_PIN} interactive={false} />}
        <FitToTrack coordinates={coordinates} />
      </MapContainer>
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-xl border border-white/40 dark:border-gray-700/40 p-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Icon size={13} className="text-rose-500" />
        {label}
      </div>
      <div className="mt-1 text-base font-bold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

export default function TrackDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [track, setTrack] = useState<TrackEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('metric');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  usePageTitle(track ? `Track: ${track.name}` : 'Track');

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
    if (!id) return;
    setLoading(true);
    tracks
      .get(id)
      .then((data: TrackEntry) => setTrack(data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load track'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDownload = async () => {
    if (!id) return;
    setDownloading(true);
    try {
      const { blob, filename } = await tracks.download(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download track');
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm('Delete this track? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await tracks.delete(id);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete track');
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error || !track) {
    return (
      <div className="text-center py-20">
        <AlertCircle size={40} className="mx-auto text-red-400 mb-3" />
        <p className="text-red-600 mb-4">{error || 'Track not found'}</p>
        <Link to="/" className="text-primary-600 hover:text-primary-700 font-medium">
          Back to Home
        </Link>
      </div>
    );
  }

  const dayKey = getLocalDateKey(track.started_at, track.timezone);
  const dayTimelinePath = `/?from=${dayKey}&to=${dayKey}`;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
      >
        <ArrowLeft size={14} />
        Back
      </Link>

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Route size={20} className="text-rose-500 shrink-0" />
          <h1 className="text-xl font-bold text-rose-700 dark:text-rose-300 break-words">
            {track.name}
          </h1>
          {track.activity_type && (
            <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
              {track.activity_type}
            </span>
          )}
        </div>

        <div className="space-y-2 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <CalendarDays size={14} />
            <span>Recorded: {formatDateTime(track.started_at, track.timezone)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={14} />
            <span>
              Start: {formatTime(track.started_at, track.timezone)} — End:{' '}
              {formatTime(track.ended_at, track.timezone)}
            </span>
            <Link
              to={dayTimelinePath}
              aria-label="View this day on Home"
              title="View this day on Home"
              className="inline-flex items-center justify-center rounded-md p-1 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <CalendarDays size={14} />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          <StatBox
            icon={Route}
            label="Distance"
            value={formatDistance(track.distance_m, distanceUnit)}
          />
          <StatBox
            icon={Clock}
            label="Moving Time"
            value={formatDuration(track.moving_time_s)}
          />
          <StatBox
            icon={Clock}
            label="Elapsed Time"
            value={formatDuration(track.elapsed_time_s)}
          />
          <StatBox
            icon={Mountain}
            label="Elevation Gain"
            value={formatDistance(track.elevation_gain_m, distanceUnit)}
          />
          <StatBox
            icon={Route}
            label="Avg Speed"
            value={formatSpeed(track.avg_speed_mps, distanceUnit)}
          />
          <StatBox
            icon={Route}
            label="Max Speed"
            value={formatSpeed(track.max_speed_mps, distanceUnit)}
          />
          {track.avg_hr != null && (
            <StatBox
              icon={Heart}
              label="Avg Heart Rate"
              value={`${Math.round(track.avg_hr)} bpm`}
            />
          )}
          {track.max_hr != null && (
            <StatBox
              icon={Heart}
              label="Max Heart Rate"
              value={`${track.max_hr} bpm`}
            />
          )}
        </div>
      </div>

      {/* Track map */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-3">
        <div className="flex items-center gap-2 px-1.5 pb-2">
          <Flag size={14} className="text-rose-500" />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Track Route</span>
          <span className="ml-auto flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-green-600 inline-block" /> Start
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-800 inline-block" /> End
            </span>
          </span>
        </div>
        <TrackMap
          coordinates={track.geometry || []}
          hoverPosition={
            hoverIndex != null && track.geometry?.[hoverIndex]
              ? [track.geometry[hoverIndex][1], track.geometry[hoverIndex][0]]
              : null
          }
        />
      </div>

      {/* Track graph */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-3">
        <div className="flex items-center gap-2 px-1.5 pb-1">
          <LineChart size={14} className="text-rose-500" />
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Track Graph</span>
        </div>
        {track.points && track.geometry && track.points.length === track.geometry.length ? (
          <TrackGraph
            coordinates={track.geometry}
            points={track.points}
            distanceUnit={distanceUnit}
            onHoverPoint={setHoverIndex}
          />
        ) : (
          <p className="px-1.5 pb-2 text-sm text-gray-400 dark:text-gray-500">
            Per-point data isn't available for this track. Re-upload the GPX file to enable the graph.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 pb-20">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          {downloading ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
          Download GPX
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="btn-danger flex items-center gap-2 text-sm"
        >
          {deleting ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
          Delete
        </button>
      </div>
    </div>
  );
}
