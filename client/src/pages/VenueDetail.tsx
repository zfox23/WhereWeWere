import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  MapPin, Tag, Navigation, Loader2, AlertCircle,
  Edit2, Save, X, GitMerge, Search, ArrowRight, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';
import { venues, checkins, settings, scrobbles as scrobblesApi, immich as immichApi } from '../api/client';
import { Venue, CheckIn, VenueCategory, Scrobble, ImmichAsset } from '../types';
import VenueEditMap from '../components/VenueEditMap';
import CheckInCard from '../components/CheckInCard';
import MapView from '../components/MapView';
import { buildImmichMapUrl } from '../utils/checkin';

const USER_ID = '00000000-0000-0000-0000-000000000001';

function normalizeCoordinate(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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

  // ── Edit mode ─────────────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editState, setEditState] = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editLat, setEditLat] = useState(0);
  const [editLng, setEditLng] = useState(0);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [categories, setCategories] = useState<VenueCategory[]>([]);

  // ── Merge mode ────────────────────────────────────────────────────────────
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeQuery, setMergeQuery] = useState('');
  const [mergeResults, setMergeResults] = useState<Venue[]>([]);
  const [mergeSearching, setMergeSearching] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Venue | null>(null);
  const [mergeConfirming, setMergeConfirming] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const mergeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    settings.get().then((s) => {
      if (s.immich_url) setImmichUrl(s.immich_url.replace(/\/+$/, ''));
      if (s.maloja_url) setMalojaUrl(s.maloja_url.replace(/\/+$/, ''));
    }).catch(() => { });
  }, []);

  useEffect(() => {
    venues.categories().then(setCategories).catch(() => { });
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
    }).catch(() => { });
  }, [venueCheckins, malojaUrl]);

  // Fetch photos for loaded check-ins (batch with deduplication)
  useEffect(() => {
    if (!immichUrl || venueCheckins.length === 0) return;
    const ids = venueCheckins.map((c) => c.id);
    immichApi.photosForCheckins(ids).then((data) => {
      setPhotosMap(data);
    }).catch(() => { });
  }, [venueCheckins, immichUrl]);

  // ── Edit helpers ──────────────────────────────────────────────────────────
  const startEditing = () => {
    if (!venue) return;
    setEditName(venue.name);
    setEditCategoryId(venue.category_id ?? '');
    setEditAddress(venue.address ?? '');
    setEditCity(venue.city ?? '');
    setEditState(venue.state ?? '');
    setEditPostalCode(venue.postal_code ?? '');
    setEditCountry(venue.country ?? '');
    setEditLat(normalizeCoordinate(venue.latitude));
    setEditLng(normalizeCoordinate(venue.longitude));
    setEditError(null);
    setIsEditing(true);
  };

  const cancelEditing = () => { setIsEditing(false); setEditError(null); };

  const saveEdit = async () => {
    if (!venue || !id) return;
    if (!editName.trim()) { setEditError('Name is required.'); return; }
    setEditSaving(true);
    setEditError(null);
    try {
      const updated = await venues.update(id, {
        name: editName.trim(),
        category_id: editCategoryId || null,
        address: editAddress.trim() || null,
        city: editCity.trim() || null,
        state: editState.trim() || null,
        postal_code: editPostalCode.trim() || null,
        country: editCountry.trim() || null,
        latitude: editLat,
        longitude: editLng,
      });
      setVenue({ ...venue, ...updated });
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Merge helpers ─────────────────────────────────────────────────────────
  const handleMergeSearch = (q: string) => {
    setMergeQuery(q);
    setMergeTarget(null);
    if (mergeDebounce.current) clearTimeout(mergeDebounce.current);
    if (!q.trim()) { setMergeResults([]); return; }
    mergeDebounce.current = setTimeout(async () => {
      setMergeSearching(true);
      try {
        const results = await venues.list({ search: q, limit: '10' });
        setMergeResults(results.filter((v: Venue) => v.id !== id));
      } catch {
        setMergeResults([]);
      } finally {
        setMergeSearching(false);
      }
    }, 300);
  };

  const doMerge = async () => {
    if (!mergeTarget || !id) return;
    setMergeConfirming(true);
    setMergeError(null);
    try {
      await venues.mergeInto(id, mergeTarget.id);
      window.location.href = `/venues/${mergeTarget.id}`;
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Merge failed.');
      setMergeConfirming(false);
    }
  };

  const toggleMergePanel = () => {
    setMergeOpen((o) => !o);
    setMergeQuery('');
    setMergeResults([]);
    setMergeTarget(null);
    setMergeError(null);
  };

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
  const venueLat = normalizeCoordinate(venue.latitude);
  const venueLng = normalizeCoordinate(venue.longitude);
  const safeEditLat = normalizeCoordinate(editLat);
  const safeEditLng = normalizeCoordinate(editLng);
  const hasVenueCoords = venue.latitude != null && venue.longitude != null;

  return (
    <div className="space-y-6">
      {/* ── Venue header ───────────────────────────── */}
      <div className="bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-700/40 p-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1 space-y-2">
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
            {immichUrl && hasVenueCoords && (
              <a
                href={buildImmichMapUrl(immichUrl, venueLat, venueLng)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-500"
              >
                <Navigation size={14} />
                <span>View in space</span>
              </a>
            )}
          </div>
          <div className="shrink-0 flex flex-col sm:flex-row gap-2 items-end sm:items-start">
            <button onClick={startEditing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              <Edit2 size={14} />Edit
            </button>
            <Link to={`/check-in?venueId=${encodeURIComponent(venue.id)}&venueName=${encodeURIComponent(venue.name)}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium">
              <MapPin size={18} />Check in here
            </Link>
          </div>
        </div>
      </div>

      {/* ── Edit venue panel ────────────────────────── */}
      {isEditing && (
        <div className="bg-white dark:bg-gray-900/60 rounded-xl border border-indigo-200 dark:border-indigo-700/50 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-gray-100">
              <Edit2 size={16} className="text-indigo-500" />Edit venue
            </h2>
            <button onClick={cancelEditing} aria-label="Cancel editing"
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
              <X size={16} />
            </button>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Name</span>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Category</span>
            <select value={editCategoryId} onChange={(e) => setEditCategoryId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">— No category —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ''}{c.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Street address</span>
              <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="123 Main St"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">City</span>
              <input type="text" value={editCity} onChange={(e) => setEditCity(e.target.value)} placeholder="Charlotte"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">State / Province</span>
              <input type="text" value={editState} onChange={(e) => setEditState(e.target.value)} placeholder="NC"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Postal code</span>
              <input type="text" value={editPostalCode} onChange={(e) => setEditPostalCode(e.target.value)} placeholder="28202"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Country</span>
              <input type="text" value={editCountry} onChange={(e) => setEditCountry(e.target.value)} placeholder="United States"
                className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </label>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Pin location</span>
              <span className="font-mono text-xs text-gray-400">{safeEditLat.toFixed(6)}, {safeEditLng.toFixed(6)}</span>
            </div>
            <div className="h-56 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
              <VenueEditMap initialCenter={[safeEditLat, safeEditLng]} zoom={15}
                onChange={(lat, lng) => { setEditLat(lat); setEditLng(lng); }} className="h-56 w-full" />
            </div>
          </div>
          {editError && (
            <p className="flex items-center gap-1.5 text-sm text-red-500">
              <AlertTriangle size={14} className="shrink-0" /> {editError}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={cancelEditing} disabled={editSaving}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button onClick={saveEdit} disabled={editSaving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors disabled:opacity-60">
              {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {editSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}

      {/* ── Map (view mode) ─────────────────────────── */}
      {!isEditing && (
        <div className="bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-700/40 overflow-hidden">
          <MapView center={[venueLat, venueLng]} zoom={15}
            markers={[{ lat: venueLat, lng: venueLng, label: venue.name, id: venue.id }]}
            className="h-64 w-full" />
        </div>
      )}

      {/* ── Merge venue panel ───────────────────────── */}
      {isEditing && (
        <div className="bg-white dark:bg-gray-900/60 rounded-xl border border-gray-200 dark:border-gray-700/40">
          <button onClick={toggleMergePanel}
            className="flex w-full items-center justify-between gap-2 rounded-xl px-5 py-3.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
            <span className="flex items-center gap-2">
              <GitMerge size={15} className="text-violet-500" />
              Merge into another venue
            </span>
            {mergeOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
          </button>
          {mergeOpen && (
            <div className="border-t border-gray-100 dark:border-gray-800 px-5 pb-5 pt-4 space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Search for the venue to keep. All check-ins from{' '}
                <strong className="text-gray-700 dark:text-gray-300">{venue.name}</strong> will be
                moved there, and this venue will be permanently deleted.
              </p>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={mergeQuery} onChange={(e) => handleMergeSearch(e.target.value)}
                  placeholder="Search venue by name…"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-8 pr-9 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500" />
                {mergeSearching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
              </div>
              {!mergeTarget && mergeResults.length > 0 && (
                <ul className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  {mergeResults.map((v) => (
                    <li key={v.id}>
                      <button onClick={() => setMergeTarget(v)}
                        className="w-full px-3 py-2.5 text-left hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors">
                        <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">{v.name}</span>
                        {(v.address || v.city) && <span className="text-xs text-gray-400">{[v.address, v.city].filter(Boolean).join(', ')}</span>}
                        {v.category_name && <span className="ml-2 text-xs text-gray-400">{v.category_name}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {mergeTarget && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5 font-semibold text-gray-800 dark:text-gray-200">{venue.name}</span>
                    <ArrowRight size={14} className="shrink-0 text-gray-400" />
                    <span className="rounded bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 font-semibold text-gray-800 dark:text-gray-200">{mergeTarget.name}</span>
                  </div>
                  <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    All check-ins will be moved and <strong>{venue.name}</strong> will be deleted. This cannot be undone.
                  </p>
                  {mergeError && <p className="text-xs text-red-500">{mergeError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => { setMergeTarget(null); setMergeError(null); }} disabled={mergeConfirming}
                      className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 transition-colors disabled:opacity-50">
                      Back
                    </button>
                    <button onClick={doMerge} disabled={mergeConfirming}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 transition-colors disabled:opacity-60">
                      {mergeConfirming ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                      {mergeConfirming ? 'Merging…' : 'Confirm merge'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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
