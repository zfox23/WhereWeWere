import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { MapPin, Clock, Pencil, Trash2, Loader2, AlertCircle, Camera, Music, ChevronRight, ArrowLeft } from 'lucide-react';
import { checkins, settings, scrobbles as scrobblesApi, immich as immichApi } from '../api/client';
import type { Scrobble, ImmichAsset } from '../types';
import MapView from '../components/MapView';

function formatDate(dateStr: string, timeZone?: string | null): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone, timeZoneName: 'short' } : {}),
  };
  return new Intl.DateTimeFormat('en-US', options).format(new Date(dateStr));
}

function formatMalojaDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function buildMalojaTrackUrl(malojaUrl: string, artists: string[], title?: string): string {
  const params = new URLSearchParams();
  for (const artist of artists) {
    params.append('trackartist', artist);
  }
  if (title) params.append('title', title);
  return `${malojaUrl}/track?${params.toString()}`;
}

function buildImmichTimeUrl(immichUrl: string, checkedInAt: string): string {
  const t = new Date(checkedInAt);
  const takenAfter = new Date(t.getTime() - 20 * 60 * 1000).toISOString();
  const takenBefore = new Date(t.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const query = JSON.stringify({ takenAfter, takenBefore });
  return `${immichUrl}/search?query=${encodeURIComponent(query)}`;
}

const THUMB_SIZE = 80;

export default function CheckInDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [checkin, setCheckin] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [malojaUrl, setMalojaUrl] = useState<string | null>(null);
  const [scrobbles, setScrobbles] = useState<Scrobble[]>([]);
  const [photos, setPhotos] = useState<ImmichAsset[]>([]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    settings.get().then((s) => {
      if (s.immich_url) setImmichUrl(s.immich_url.replace(/\/+$/, ''));
      if (s.maloja_url) setMalojaUrl(s.maloja_url.replace(/\/+$/, ''));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    checkins.get(id).then((data) => {
      setCheckin(data);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load check-in');
    }).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id || !malojaUrl) return;
    scrobblesApi.forCheckins([id]).then((data) => {
      setScrobbles(data[id] || []);
    }).catch(() => {});
  }, [id, malojaUrl]);

  useEffect(() => {
    if (!id || !immichUrl) return;
    immichApi.photosForCheckins([id]).then((data) => {
      setPhotos(data[id] || []);
    }).catch(() => {});
  }, [id, immichUrl]);

  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm('Delete this check-in? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await checkins.delete(id);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete.');
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

  if (error || !checkin) {
    return (
      <div className="text-center py-20">
        <AlertCircle size={40} className="mx-auto text-red-400 mb-3" />
        <p className="text-red-600 mb-4">{error || 'Check-in not found'}</p>
        <Link to="/" className="text-primary-600 hover:text-primary-700 font-medium">
          Back to Home
        </Link>
      </div>
    );
  }

  const hasCoords = checkin.venue_latitude != null && checkin.venue_longitude != null;
  const fullAddress = [checkin.venue_address, checkin.venue_city, checkin.venue_state, checkin.venue_country]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Back link */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
        <ArrowLeft size={14} />
        Back
      </Link>

      {/* Main card */}
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
        {/* Venue name */}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <MapPin size={20} className="text-primary-500 shrink-0" />
            <Link
              to={`/venues/${checkin.venue_id}`}
              className="text-xl font-bold text-primary-700 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 transition-colors"
            >
              {checkin.venue_name || 'Unknown Venue'}
            </Link>
          </div>
          {checkin.parent_venue_name && (
            <Link
              to={`/venues/${checkin.parent_venue_id}`}
              className="text-sm text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors ml-7"
            >
              {checkin.parent_venue_name}
            </Link>
          )}
        </div>

        {/* Category */}
        {checkin.venue_category && (
          <span className="inline-block px-2.5 py-0.5 text-xs font-medium rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">
            {checkin.venue_category}
          </span>
        )}

        {/* Address */}
        {fullAddress && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{fullAddress}</p>
        )}

        {/* Date/time */}
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Clock size={14} />
          <time dateTime={checkin.checked_in_at}>
            {formatDate(checkin.checked_in_at, checkin.venue_timezone)}
          </time>
        </div>

        {/* Notes */}
        {checkin.notes && (
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{checkin.notes}</p>
        )}

        {/* Photos */}
        {immichUrl && photos.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
              <Camera size={14} />
              <span className="font-medium">Photos</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {photos.map((asset) => (
                <a
                  key={asset.id}
                  href={`${immichUrl}/photos/${asset.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg overflow-hidden hover:ring-2 hover:ring-primary-400 transition-all"
                >
                  <img
                    src={immichApi.thumbnailUrl(asset.id)}
                    alt={asset.originalFileName}
                    width={THUMB_SIZE}
                    height={THUMB_SIZE}
                    className="object-cover"
                    style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
            <div className="flex items-center gap-3 text-indigo-600 dark:text-indigo-300">
              <a
                href={buildImmichTimeUrl(immichUrl, checkin.checked_in_at)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium hover:text-indigo-800 dark:hover:text-indigo-500"
              >
                View in time
              </a>
            </div>
          </div>
        )}

        {/* Scrobbles */}
        {scrobbles.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
              <Music size={14} />
              <span className="font-medium">Listening</span>
            </div>
            <div className="space-y-1">
              {scrobbles.map((s, i) => (
                <div key={i} className="text-sm text-gray-500 dark:text-gray-400">
                  {malojaUrl ? (
                    <>
                      {s.artists.map((artist: string, j: number) => (
                        <span key={j}>
                          {j > 0 && ', '}
                          <a
                            href={buildMalojaTrackUrl(malojaUrl, [artist])}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                          >
                            {artist}
                          </a>
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="font-medium text-gray-600 dark:text-gray-300">{s.artists.join(', ')}</span>
                  )}
                  {' — '}
                  {malojaUrl ? (
                    <a
                      href={buildMalojaTrackUrl(malojaUrl, s.artists, s.title)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                    >
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Link
            to={`/check-in?edit=${checkin.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <Pencil size={14} />
            Edit
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
          >
            <Trash2 size={14} />
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Map */}
      {hasCoords && (
        <div className="page-map-breakout bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] overflow-hidden">
          <MapView
            center={[Number(checkin.venue_latitude), Number(checkin.venue_longitude)]}
            zoom={15}
            markers={[{
              lat: Number(checkin.venue_latitude),
              lng: Number(checkin.venue_longitude),
              label: checkin.venue_name || 'Venue',
              id: checkin.venue_id,
            }]}
            className="h-[22rem] md:h-[30rem] w-full"
          />
        </div>
      )}
    </div>
  );
}
