import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { MapPin, Tag, Navigation, Loader2, AlertCircle } from 'lucide-react';
import { venues, checkins, settings, scrobbles as scrobblesApi, immich as immichApi } from '../api/client';
import { Venue, CheckIn, Scrobble, ImmichAsset } from '../types';
import CheckInCard from '../components/CheckInCard';
import MapView from '../components/MapView';

const USER_ID = '00000000-0000-0000-0000-000000000001';

export default function VenueDetail() {
  const { id } = useParams<{ id: string }>();
  const [venue, setVenue] = useState<Venue | null>(null);
  const [venueCheckins, setVenueCheckins] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [malojaUrl, setMalojaUrl] = useState<string | null>(null);
  const [scrobblesMap, setScrobblesMap] = useState<Record<string, Scrobble[]>>({});
  const [photosMap, setPhotosMap] = useState<Record<string, ImmichAsset[]>>({});

  useEffect(() => {
    settings.get().then((s) => {
      if (s.immich_url) setImmichUrl(s.immich_url.replace(/\/+$/, ''));
      if (s.maloja_url) setMalojaUrl(s.maloja_url.replace(/\/+$/, ''));
    }).catch(() => {});
  }, []);

  const fetchData = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [venueData, checkinData] = await Promise.all([
        venues.get(id),
        checkins.list({ venue_id: id, user_id: USER_ID }),
      ]);
      setVenue(venueData);
      setVenueCheckins(checkinData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load venue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  // Fetch scrobbles for loaded check-ins
  useEffect(() => {
    if (!malojaUrl || venueCheckins.length === 0) return;
    const ids = venueCheckins.map((c) => c.id);
    scrobblesApi.forCheckins(ids).then((data) => {
      setScrobblesMap(data);
    }).catch(() => {});
  }, [venueCheckins, malojaUrl]);

  // Fetch photos for loaded check-ins (batch with deduplication)
  useEffect(() => {
    if (!immichUrl || venueCheckins.length === 0) return;
    const ids = venueCheckins.map((c) => c.id);
    immichApi.photosForCheckins(ids).then((data) => {
      setPhotosMap(data);
    }).catch(() => {});
  }, [venueCheckins, immichUrl]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (error || !venue) {
    return (
      <div className="text-center py-20">
        <AlertCircle size={40} className="mx-auto text-red-400 mb-3" />
        <p className="text-red-600 mb-4">{error || 'Venue not found'}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const fullAddress = [venue.address, venue.city, venue.state, venue.postal_code, venue.country]
    .filter(Boolean)
    .join(', ');

  const markers = [
    {
      lat: venue.latitude,
      lng: venue.longitude,
      label: venue.name,
      id: venue.id,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Venue Header */}
      <div className="bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-700/40 p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            {venue.parent_venue_name && (
              <Link
                to={`/venues/${venue.parent_venue_id}`}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
              >
                {venue.parent_venue_name}
              </Link>
            )}
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{venue.name}</h1>
            {venue.category_name && (
              <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                <Tag size={14} />
                <span>{venue.category_name}</span>
              </div>
            )}
            {fullAddress && (
              <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
                <Navigation size={14} />
                <span>{fullAddress}</span>
              </div>
            )}
            {venue.checkin_count != null && (
              <p className="text-sm text-gray-500">
                {venue.checkin_count} check-in{venue.checkin_count !== 1 ? 's' : ''} here
              </p>
            )}
          </div>
          <Link
            to={`/check-in?venueId=${encodeURIComponent(venue.id)}&venueName=${encodeURIComponent(venue.name)}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium shrink-0"
          >
            <MapPin size={18} />
            Check in here
          </Link>
        </div>
      </div>

      {/* Map */}
      <div className="bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-700/40 overflow-hidden">
        <MapView
          center={[venue.latitude, venue.longitude]}
          zoom={15}
          markers={markers}
          className="h-64 w-full"
        />
      </div>

      {/* Child venues (e.g. terminals inside an airport) */}
      {venue.child_venues && venue.child_venues.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Places Inside</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {venue.child_venues.map((child) => (
              <Link
                key={child.id}
                to={`/venues/${child.id}`}
                className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <MapPin size={14} className="text-primary-500 shrink-0" />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{child.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Check-ins at this venue */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Your Check-ins Here
        </h2>
        {venueCheckins.length === 0 ? (
          <div className="bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-700/40 p-8 text-center">
            <MapPin size={40} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">You haven't checked in here yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {venueCheckins.map((checkin) => (
              <CheckInCard
                key={checkin.id}
                checkin={checkin}
                immichUrl={immichUrl}
                photos={photosMap[checkin.id] ?? null}
                scrobbles={scrobblesMap[checkin.id]}
                malojaUrl={malojaUrl}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
