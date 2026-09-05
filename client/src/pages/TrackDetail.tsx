import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Clock,
  Download,
  Edit2,
  Flag,
  Heart,
  LineChart,
  Loader2,
  Mountain,
  Plus,
  Route,
  Save,
  Trash2,
  X,
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
        attributionControl={false}
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

  // ── Edit mode ───────────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editActivityType, setEditActivityType] = useState('');
  const [activityTypes, setActivityTypes] = useState<string[]>([]);
  const [typeSuggestOpen, setTypeSuggestOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEditing = () => {
    if (!track) return;
    setEditName(track.name);
    setEditActivityType(track.activity_type ?? '');
    setSaveError(null);
    setIsEditing(true);
    tracks
      .activityTypes()
      .then(setActivityTypes)
      .catch(() => setActivityTypes([]));
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setTypeSuggestOpen(false);
    setSaveError(null);
  };

  const trimmedType = editActivityType.trim();
  const isNewType =
    trimmedType.length > 0 &&
    !activityTypes.some((t) => t.toLowerCase() === trimmedType.toLowerCase());

  const typeSuggestions = useMemo(() => {
    const q = trimmedType.toLowerCase();
    return activityTypes
      .filter((t) => (q ? t.toLowerCase().includes(q) : true))
      .filter((t) => t.toLowerCase() !== q)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, 8);
  }, [activityTypes, trimmedType]);

  const selectActivityType = (type: string) => {
    setEditActivityType(type);
    setTypeSuggestOpen(false);
  };

  const handleTypeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setTypeSuggestOpen(false);
    } else if (e.key === 'Enter' && typeSuggestOpen && (typeSuggestions.length > 0 || isNewType)) {
      e.preventDefault();
      if (typeSuggestions.length > 0) selectActivityType(typeSuggestions[0]);
      else if (isNewType) selectActivityType(trimmedType);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !track) return;
    const name = editName.trim();
    if (!name) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await tracks.update(id, {
        name,
        activity_type: trimmedType || null,
      });
      setTrack(updated);
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

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

      {isEditing ? (
        <form
          onSubmit={handleSave}
          className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-indigo-200 dark:border-indigo-700/50 shadow-sm shadow-black/3 p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Edit2 size={16} className="text-indigo-500" />
              Edit track
            </h2>
            <button
              type="button"
              onClick={cancelEditing}
              aria-label="Cancel editing"
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div>
            <label htmlFor="track-edit-name" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Name
            </label>
            <input
              id="track-edit-name"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={200}
              required
              autoFocus
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="relative">
            <label htmlFor="track-edit-activity-type" className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Activity type
            </label>
            <input
              id="track-edit-activity-type"
              type="text"
              value={editActivityType}
              onChange={(e) => {
                setEditActivityType(e.target.value);
                setTypeSuggestOpen(true);
              }}
              onFocus={() => setTypeSuggestOpen(true)}
              onBlur={() => setTypeSuggestOpen(false)}
              onKeyDown={handleTypeKeyDown}
              maxLength={100}
              placeholder="e.g. Cycling — or type a new type"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {typeSuggestOpen && (typeSuggestions.length > 0 || isNewType) && (
              <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg divide-y divide-gray-100 dark:divide-gray-800">
                {isNewType && (
                  <li>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectActivityType(trimmedType);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                    >
                      <Plus size={13} className="shrink-0" />
                      Add “{trimmedType}” as a new activity type
                    </button>
                  </li>
                )}
                {typeSuggestions.map((type) => (
                  <li key={type}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectActivityType(type);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-gray-800 dark:text-gray-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                    >
                      {type}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {saveError && (
            <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertCircle size={13} className="shrink-0" />
              {saveError}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !editName.trim()}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
              Save
            </button>
            <button
              type="button"
              onClick={cancelEditing}
              className="btn-secondary flex items-center gap-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
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
          <button
            onClick={startEditing}
            aria-label="Edit track"
            title="Edit track"
            className="ml-auto inline-flex items-center justify-center rounded-md p-1.5 text-gray-500 hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <Edit2 size={16} />
          </button>
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
      )}

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
