import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, MapPin, Plus, Loader2, Navigation, LocateFixed, Navigation2 } from 'lucide-react';
import { settings, venues } from '../../../client/src/api/client';
import { useLocation } from './LocationContext';
import { haversineDistance, getBearingDegrees, formatDistance } from './geo';
import VenueEditMap from './VenueEditMap';
import type { NearbyVenue, VenueCategory } from '../../../client/src/types';
import type { DistanceUnit } from './geo';

const NEARBY_PAGE_SIZE = 20;
const DEFAULT_NEARBY_RADIUS_METERS = 5000;
const QUERY_NEARBY_RADIUS_METERS = 10000;

interface PlaceSearchResult {
  name: string;
  latitude: number;
  longitude: number;
  lat?: string | number;
  lon?: string | number;
}

export interface SelectedVenue {
  id: string;
  name: string;
  parent_venue_id?: string | null;
  parent_venue_name?: string | null;
}

interface VenueSearchProps {
  onSelect: (venue: SelectedVenue) => void;
  initialLat?: number;
  initialLon?: number;
}

export default function VenueSearch({ onSelect, initialLat, initialLon }: VenueSearchProps) {
  const prefetched = useLocation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NearbyVenue[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [osmLoading, setOsmLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapSearchLoading, setMapSearchLoading] = useState(false);
  const [mapSearchResults, setMapSearchResults] = useState<PlaceSearchResult[]>([]);
  const [categories, setCategories] = useState<VenueCategory[]>([]);
  const [selectedNearbyMarkerId, setSelectedNearbyMarkerId] = useState<string | null>(null);
  const [refreshingBrowserLocation, setRefreshingBrowserLocation] = useState(false);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>('metric');
  const usedPrefetchRef = useRef(false);

  // Custom venue form state
  const [customName, setCustomName] = useState('');
  const [customAddress, setCustomAddress] = useState('');
  const [customCategoryId, setCustomCategoryId] = useState('');
  const [customLat, setCustomLat] = useState<number | null>(null);
  const [customLng, setCustomLng] = useState<number | null>(null);
  const [creatingCustom, setCreatingCustom] = useState(false);
  const [customAddressGeocoding, setCustomAddressGeocoding] = useState(false);
  const [customAddressError, setCustomAddressError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customVenueFormRef = useRef<HTMLFormElement | null>(null);
  const customNameInputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);
  const localCountRef = useRef(0);
  const osmCountRef = useRef(0);
  const localHasMoreRef = useRef(false);
  const osmHasMoreRef = useRef(false);
  const customAddressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customAddressRequestIdRef = useRef(0);
  const browserCoords = prefetched.coords;
  const searchRadiusMeters = query.trim()
    ? QUERY_NEARBY_RADIUS_METERS
    : DEFAULT_NEARBY_RADIUS_METERS;
  const customMapCenter = useMemo<[number, number] | null>(() => {
    if (customLat == null || customLng == null) return null;
    return [customLat, customLng];
  }, [customLat, customLng]);

  const getVenueKey = useCallback((venue: NearbyVenue) => {
    if (venue.source === 'local' && venue.id) return `local:${venue.id}`;
    if (venue.osm_id) return `osm:${venue.osm_id}`;
    return `${venue.name}:${venue.latitude}:${venue.longitude}`;
  }, []);

  const venuesByMarkerId = useMemo(() => {
    const markerMap = new Map<string, NearbyVenue>();
    results.forEach((venue) => {
      markerMap.set(getVenueKey(venue), venue);
    });
    return markerMap;
  }, [results, getVenueKey]);

  const mapMarkers = useMemo(() => {
    const venueMarkers = results.map((venue) => ({
      lat: venue.latitude,
      lng: venue.longitude,
      label: venue.name,
      id: getVenueKey(venue),
      variant: selectedNearbyMarkerId === getVenueKey(venue) ? 'selected' as const : 'default' as const,
    }));

    if (!browserCoords) return venueMarkers;

    return [
      {
        lat: browserCoords.lat,
        lng: browserCoords.lon,
        label: 'Your current location',
        variant: 'current' as const,
      },
      ...venueMarkers,
    ];
  }, [results, browserCoords, getVenueKey, selectedNearbyMarkerId]);

  useEffect(() => {
    if (!selectedNearbyMarkerId) return;
    if (venuesByMarkerId.has(selectedNearbyMarkerId)) return;
    setSelectedNearbyMarkerId(null);
  }, [venuesByMarkerId, selectedNearbyMarkerId]);

  const sortVenuesByDistance = useCallback(
    (venues: NearbyVenue[], center: { lat: number; lon: number }) =>
      [...venues].sort(
        (a, b) =>
          haversineDistance(center.lat, center.lon, a.latitude, a.longitude) -
          haversineDistance(center.lat, center.lon, b.latitude, b.longitude)
      ),
    []
  );

  // Fetch local and OSM venues in parallel. Local results come from our own
  // DB and render immediately; OSM results (slow external Overpass call) are
  // merged in once they arrive, with a spinner shown in the meantime.
  const searchNearby = useCallback(
    async (
      searchQuery: string,
      append = false,
      searchCoords: { lat: number; lon: number } | null = null,
      opts: { localResults?: NearbyVenue[] | null } = {}
    ) => {
      const coordsToUse = searchCoords || coords;
      if (!coordsToUse) return;
      const requestId = ++requestIdRef.current;

      const baseParams: Record<string, string> = {
        lat: coordsToUse.lat.toString(),
        lon: coordsToUse.lon.toString(),
        radius: (searchQuery.trim() ? QUERY_NEARBY_RADIUS_METERS : DEFAULT_NEARBY_RADIUS_METERS).toString(),
        limit: NEARBY_PAGE_SIZE.toString(),
      };
      if (searchQuery.trim()) {
        baseParams.search = searchQuery.trim();
      }

      if (append) {
        setLoadingMore(true);
      } else {
        if (!opts.localResults) {
          setLoading(true);
        }
        setOsmLoading(true);
        osmCountRef.current = 0;
        osmHasMoreRef.current = false;
        if (!opts.localResults) {
          localCountRef.current = 0;
          localHasMoreRef.current = false;
        }
      }

      const localOffset = localCountRef.current;
      const osmOffset = osmCountRef.current;

      const mergeVenues = (prev: NearbyVenue[], incoming: NearbyVenue[]) => {
        const deduped = new Map<string, NearbyVenue>();
        [...prev, ...incoming].forEach((venue) => deduped.set(getVenueKey(venue), venue));
        return sortVenuesByDistance(Array.from(deduped.values()), coordsToUse);
      };

      const localPromise = opts.localResults
        ? Promise.resolve(opts.localResults)
        : venues.nearby({ ...baseParams, offset: localOffset.toString(), source: 'local' });

      void localPromise
        .then((data) => {
          if (requestId !== requestIdRef.current) return;
          localCountRef.current += data.length;
          localHasMoreRef.current = data.length === NEARBY_PAGE_SIZE;
          if (append) {
            setResults((prev) => mergeVenues(prev, data));
          } else {
            setResults(sortVenuesByDistance(data, coordsToUse));
          }
          setHasMoreResults(localHasMoreRef.current || osmHasMoreRef.current);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          localHasMoreRef.current = false;
          if (!append) {
            setResults([]);
          }
          setHasMoreResults(localHasMoreRef.current || osmHasMoreRef.current);
        })
        .finally(() => {
          if (requestId !== requestIdRef.current) return;
          if (append) {
            setLoadingMore(false);
          } else {
            setLoading(false);
          }
        });

      void venues
        .nearby({ ...baseParams, offset: osmOffset.toString(), source: 'osm' })
        .then((data) => {
          if (requestId !== requestIdRef.current) return;
          osmCountRef.current += data.length;
          osmHasMoreRef.current = data.length === NEARBY_PAGE_SIZE;
          if (data.length > 0) {
            setResults((prev) => mergeVenues(prev, data));
          }
          setHasMoreResults(localHasMoreRef.current || osmHasMoreRef.current);
        })
        .catch(() => {
          if (requestId !== requestIdRef.current) return;
          osmHasMoreRef.current = false;
          setHasMoreResults(localHasMoreRef.current || osmHasMoreRef.current);
        })
        .finally(() => {
          if (requestId !== requestIdRef.current) return;
          setOsmLoading(false);
        });
    },
    [coords, getVenueKey, sortVenuesByDistance]
  );

  // Determine coordinates from explicit params or LocationContext prefetch.
  // Avoid a second geolocation flow here, which can duplicate nearby requests.
  useEffect(() => {
    if (initialLat !== undefined && initialLon !== undefined) {
      setCoords({ lat: initialLat, lon: initialLon });
      return;
    }
    // Use prefetched coords if available
    if (prefetched.coords) {
      setCoords(prefetched.coords);
      // Use prefetched (local-only) venues as immediate results, then fetch
      // OSM venues in the background while a spinner is shown.
      if (prefetched.nearbyVenues && !usedPrefetchRef.current) {
        usedPrefetchRef.current = true;
        localCountRef.current = prefetched.nearbyVenues.length;
        localHasMoreRef.current = prefetched.nearbyVenues.length === NEARBY_PAGE_SIZE;
        setResults(sortVenuesByDistance(prefetched.nearbyVenues, prefetched.coords));
        setHasMoreResults(localHasMoreRef.current);
        void searchNearby('', false, prefetched.coords, { localResults: prefetched.nearbyVenues });
      }
      return;
    }
    // Wait for LocationContext to resolve coordinates.
    setCoords(null);
  }, [initialLat, initialLon, prefetched.coords, prefetched.nearbyVenues, searchNearby, sortVenuesByDistance]);

  // Load categories for custom venue form
  useEffect(() => {
    venues.categories().then(setCategories).catch(() => { });
  }, []);

  useEffect(() => {
    settings
      .get()
      .then((s) => {
        const unit = s?.distance_unit;
        if (unit === 'metric' || unit === 'imperial') {
          setDistanceUnit(unit);
        }
      })
      .catch(() => { });
  }, []);

  // Keep default custom venue coordinates in sync with detected/prefetched coords.
  useEffect(() => {
    if (!coords) return;
    setCustomLat((prev) => prev ?? coords.lat);
    setCustomLng((prev) => prev ?? coords.lon);
  }, [coords]);

  // When the custom venue form opens, scroll it to the top of the viewport
  // (below the sticky header, via scroll-mt on the form) and focus the name
  // field.
  //
  // Note: smooth scrollIntoView works correctly here because .app-shell uses
  // `overflow: clip` (not `overflow: hidden`). A hidden-overflow ancestor is a
  // scroll container, so Chrome's smooth scrollIntoView can scroll *that*
  // box instead of the viewport, stranding the page with the top unreachable.
  // `overflow: clip` clips the decorative background the same way but is not
  // scrollable, so scrollIntoView targets the real page scroll.
  useEffect(() => {
    if (!showCreateForm) return;
    const frame = requestAnimationFrame(() => {
      const form = customVenueFormRef.current;
      if (form) {
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      customNameInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [showCreateForm]);

  useEffect(() => {
    if (!showCreateForm) {
      if (customAddressDebounceRef.current) {
        clearTimeout(customAddressDebounceRef.current);
      }
      setCustomAddressGeocoding(false);
      setCustomAddressError(null);
      return;
    }

    const q = customAddress.trim();
    if (!q || q.length < 4) {
      if (customAddressDebounceRef.current) {
        clearTimeout(customAddressDebounceRef.current);
      }
      setCustomAddressGeocoding(false);
      setCustomAddressError(null);
      return;
    }

    if (customAddressDebounceRef.current) {
      clearTimeout(customAddressDebounceRef.current);
    }

    customAddressDebounceRef.current = setTimeout(() => {
      const requestId = ++customAddressRequestIdRef.current;
      setCustomAddressGeocoding(true);
      setCustomAddressError(null);

      void venues
        .placeSearch({ q, limit: '1' })
        .then((places) => {
          if (requestId !== customAddressRequestIdRef.current) return;
          const topMatch = (places as PlaceSearchResult[])[0];
          if (!topMatch) {
            setCustomAddressError('Could not find that address. Try adding city or state.');
            return;
          }

          const resolvedLat =
            typeof topMatch.latitude === 'number'
              ? topMatch.latitude
              : Number(topMatch.lat);
          const resolvedLng =
            typeof topMatch.longitude === 'number'
              ? topMatch.longitude
              : Number(topMatch.lon);

          if (!Number.isFinite(resolvedLat) || !Number.isFinite(resolvedLng)) {
            setCustomAddressError('Address lookup returned invalid coordinates.');
            return;
          }

          setCustomLat(resolvedLat);
          setCustomLng(resolvedLng);
        })
        .catch(() => {
          if (requestId !== customAddressRequestIdRef.current) return;
          setCustomAddressError('Failed to look up address. Please try again.');
        })
        .finally(() => {
          if (requestId !== customAddressRequestIdRef.current) return;
          setCustomAddressGeocoding(false);
        });
    }, 450);

    return () => {
      if (customAddressDebounceRef.current) {
        clearTimeout(customAddressDebounceRef.current);
      }
    };
  }, [customAddress, showCreateForm]);

  // Debounced search
  useEffect(() => {
    if (!coords) return;
    const isEmptyQuery = !query.trim();
    const hasInitialCoords = initialLat !== undefined && initialLon !== undefined;
    const searchDelayMs = isEmptyQuery ? 0 : 300;

    // For the default check-in flow, initial nearby data comes from LocationContext prefetch.
    // Skip firing a duplicate empty-query fetch from this component.
    if (isEmptyQuery && !hasInitialCoords) {
      if (prefetched.loading || prefetched.nearbyVenues) {
        return;
      }
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchNearby(query);
    }, searchDelayMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, coords, searchNearby, initialLat, initialLon, prefetched.loading, prefetched.nearbyVenues]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    const newCoords = { lat, lon: lng };
    setCoords(newCoords);

    // Clear any pending debounced search to search immediately
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Immediately search with the new coordinates and current query
    void searchNearby(query, false, newCoords);
  }, [query, searchNearby]);

  const handlePlaceSelect = useCallback((lat: number, lon: number) => {
    const newCoords = { lat, lon };
    setLocationError(null);
    setCoords(newCoords);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    void searchNearby(query, false, newCoords);
  }, [query, searchNearby]);

  const handleResetToBrowserLocation = useCallback(async () => {
    setRefreshingBrowserLocation(true);
    setLocationError(null);
    setMapSearchQuery('');
    setMapSearchResults([]);

    const latestCoords = await prefetched.refetch();
    const coordsToUse = latestCoords ?? browserCoords;

    if (coordsToUse) {
      handlePlaceSelect(coordsToUse.lat, coordsToUse.lon);
    } else {
      setLocationError('Current location unavailable. Check location permissions and try again.');
    }

    setRefreshingBrowserLocation(false);
  }, [browserCoords, handlePlaceSelect, prefetched]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || osmLoading || !hasMoreResults) return;
    searchNearby(query, true);
  }, [loading, loadingMore, osmLoading, hasMoreResults, searchNearby, query]);

  const handleSelectLocal = (venue: NearbyVenue) => {
    if (venue.id) {
      onSelect({ id: venue.id, name: venue.name });
    }
  };

  const handleSelectOsm = async (venue: NearbyVenue) => {
    setImporting(venue.osm_id);
    try {
      const imported = await venues.importOsm({
        name: venue.name,
        category: venue.category,
        latitude: venue.latitude,
        longitude: venue.longitude,
        address: venue.address,
        osm_id: venue.osm_id,
      });
      onSelect({
        id: imported.id,
        name: imported.name,
        parent_venue_id: imported.parent_venue_id || null,
        parent_venue_name: imported.parent_venue_name || null,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to import venue');
    } finally {
      setImporting(null);
    }
  };

  const handleMapMarkerSelect = useCallback((markerId: string) => {
    setSelectedNearbyMarkerId(markerId);
  }, []);

  const handleMapMarkerConfirm = useCallback((markerId: string) => {
    const venue = venuesByMarkerId.get(markerId);
    if (!venue) return;

    setSelectedNearbyMarkerId(markerId);

    if (venue.source === 'local') {
      handleSelectLocal(venue);
      return;
    }

    void handleSelectOsm(venue);
  }, [venuesByMarkerId]);

  const handleCreateCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || customLat == null || customLng == null) return;
    setCreatingCustom(true);
    try {
      const created = await venues.create({
        name: customName.trim(),
        address: customAddress.trim() || null,
        category_id: customCategoryId || null,
        latitude: customLat,
        longitude: customLng,
      });
      onSelect({ id: created.id, name: created.name });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create venue');
    } finally {
      setCreatingCustom(false);
    }
  };

  const handleMapSearch = useCallback(async () => {
    const q = mapSearchQuery.trim();
    if (!q) {
      setMapSearchResults([]);
      setLocationError(null);
      return;
    }

    setMapSearchLoading(true);
    setLocationError(null);
    try {
      const places = (await venues.placeSearch({ q, limit: '5' })) as PlaceSearchResult[];
      setMapSearchResults(places);
      if (places.length > 0) {
        handlePlaceSelect(places[0].latitude, places[0].longitude);
      } else {
        setLocationError('No matching places found. Try a more specific place name.');
      }
    } catch {
      setMapSearchResults([]);
      setLocationError('Failed to search places. Please try again.');
    } finally {
      setMapSearchLoading(false);
    }
  }, [handlePlaceSelect, mapSearchQuery]);

  return (
    <div className="space-y-3">
      {/* Unified map and search center controls */}
      <div className="space-y-1.5 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
        {/* Search by place name */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleResetToBrowserLocation()}
            disabled={!browserCoords || refreshingBrowserLocation}
            aria-label="Reset search center to current location"
            title={browserCoords ? 'Reset to current location' : 'Current location unavailable'}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-gray-50 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-primary-400"
          >
            {refreshingBrowserLocation ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <LocateFixed size={16} />
            )}
          </button>
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={mapSearchQuery}
              onChange={(e) => setMapSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleMapSearch();
                }
              }}
              placeholder="Move search center to place..."
              className="w-full pl-8 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleMapSearch()}
            disabled={mapSearchLoading}
            className="px-3 py-2 text-xs font-semibold text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50"
          >
            {mapSearchLoading ? 'Finding...' : 'Find'}
          </button>
        </div>

        {/* Place search results dropdown */}
        {mapSearchResults.length > 0 && (
          <ul className="max-h-28 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-md">
            {mapSearchResults.map((place, idx) => (
              <li key={`${place.name}:${place.latitude}:${place.longitude}`}>
                <button
                  type="button"
                  onClick={() => handlePlaceSelect(place.latitude, place.longitude)}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="block text-xs font-medium text-gray-800 dark:text-gray-100 truncate">
                    {place.name}
                  </span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                    {idx === 0 ? 'Best match' : 'Alternative'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Interactive map */}
        {coords && mapMarkers.length > 0 ? (
          <div className="h-80 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <VenueEditMap
              initialCenter={[coords.lat, coords.lon]}
              viewCenter={[coords.lat, coords.lon]}
              centerCircle={{
                center: [coords.lat, coords.lon],
                radiusMeters: searchRadiusMeters,
              }}
              zoom={15}
              markers={mapMarkers}
              selectedMarkerId={selectedNearbyMarkerId ?? undefined}
              onMarkerSelect={handleMapMarkerSelect}
              onMarkerClick={handleMapMarkerConfirm}
              onMapClick={handleMapClick}
              className="h-96 w-full"
            />
          </div>
        ) : null}
      </div>
      
      <div className="space-y-1.5 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">

      {/* Search input for venue filtering */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={coords
            ? `Search venues around ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}...`
            : 'Search venues around your location...'}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {locationError && (
        <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded-md px-3 py-2">
          {locationError}
        </p>
      )}

      {/* Results list */}
      {(loading || (osmLoading && results.length === 0)) && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-3 justify-center">
          <Loader2 size={16} className="animate-spin" />
          {loading ? 'Searching nearby...' : 'Fetching OSM venues...'}
        </div>
      )}

      {!loading && results.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
          {results.map((venue) => (
            (() => {
              const distanceMeters = coords
                ? haversineDistance(coords.lat, coords.lon, venue.latitude, venue.longitude)
                : null;
              const bearing = coords
                ? getBearingDegrees(coords.lat, coords.lon, venue.latitude, venue.longitude)
                : null;

              return (
            <li key={getVenueKey(venue)}>
              <button
                type="button"
                onClick={() =>
                  venue.source === 'local'
                    ? handleSelectLocal(venue)
                    : handleSelectOsm(venue)
                }
                disabled={importing !== null && importing === venue.osm_id}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50 flex items-start gap-2.5"
              >
                <MapPin
                  size={16}
                  className="text-gray-400 mt-0.5 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                      {venue.name}
                    </span>
                    <span
                      className={`shrink-0 inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${venue.source === 'local'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        }`}
                    >
                      {venue.source === 'local' ? 'Local' : 'OSM'}
                    </span>
                    {distanceMeters != null && bearing != null && (
                      <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        <Navigation2
                          size={10}
                          className="text-gray-500 dark:text-gray-400"
                          style={{ transform: `rotate(${bearing}deg)` }}
                        />
                        <span>{formatDistance(distanceMeters, distanceUnit)}</span>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                    {[venue.category, venue.address]
                      .filter(Boolean)
                      .join(' \u00b7 ')}
                  </div>
                </div>
                {importing !== null && importing === venue.osm_id && (
                  <Loader2
                    size={14}
                    className="animate-spin text-gray-400 mt-1 shrink-0"
                  />
                )}
              </button>
            </li>
              );
            })()
          ))}
          {osmLoading && (
            <li className="py-2.5 text-center text-xs text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Fetching OSM venues...
              </span>
            </li>
          )}
          {loadingMore && (
            <li className="py-2.5 text-center text-xs text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Loading more venues...
              </span>
            </li>
          )}
          {hasMoreResults && !loadingMore && (
            <li className="py-2.5 text-center">
              <button
                type="button"
                onClick={loadMore}
                className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
              >
                Load more venues...
              </button>
            </li>
          )}
        </ul>
      )}

      {!loading && !osmLoading && results.length === 0 && coords && query && (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">
          No venues found. Try a different search or create a custom venue.
        </p>
      )}

      {/* Create custom venue toggle */}
      {!showCreateForm ? (
        <button
          type="button"
          onClick={() => {
            setShowCreateForm(true);
            if (coords) {
              setCustomLat(coords.lat);
              setCustomLng(coords.lon);
            }
          }}
          className="flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
        >
          <Plus size={14} />
          Create Custom Venue
        </button>
      ) : (
        <form
          ref={customVenueFormRef}
          onSubmit={handleCreateCustom}
          className="scroll-mt-17 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3 bg-gray-50 dark:bg-gray-800"
        >
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            New Custom Venue
          </h4>
          <input
            ref={customNameInputRef}
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Venue name*"
            required
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <input
            type="text"
            value={customAddress}
            onChange={(e) => setCustomAddress(e.target.value)}
            placeholder="Address (optional)"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {customAddressGeocoding && (
            <p className="text-xs text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Locating address on map...
            </p>
          )}
          {!customAddressGeocoding && customAddressError && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{customAddressError}</p>
          )}
          {categories.length > 0 && (
            <select
              value={customCategoryId}
              onChange={(e) => setCustomCategoryId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select category (optional)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {customLat != null && customLng != null && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Pin location</span>
                <span className="font-mono text-xs text-gray-400">
                  {customLat.toFixed(6)}, {customLng.toFixed(6)}
                </span>
              </div>
              <div className="h-96 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                <VenueEditMap
                  initialCenter={[customLat, customLng]}
                  viewCenter={customMapCenter}
                  zoom={15}
                  onMapClick={(lat, lng) => {
                    setCustomLat(lat);
                    setCustomLng(lng);
                  }}
                  onChange={(lat, lng) => {
                    setCustomLat(lat);
                    setCustomLng(lng);
                  }}
                  className="h-96 w-full"
                />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!customName.trim() || customLat == null || customLng == null || creatingCustom}
              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {creatingCustom ? 'Creating...' : 'Create Venue'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      </div>
    </div>
  );
}
