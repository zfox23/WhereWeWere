import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, MapPin, Plus, Loader2, Navigation } from 'lucide-react';
import { venues } from '../api/client';
import { useLocation } from '../contexts/LocationContext';
import { haversineDistance } from '../utils/geo';
import MapView from './MapView';
import VenueEditMap from './VenueEditMap';
import type { NearbyVenue, VenueCategory } from '../types';

const NEARBY_PAGE_SIZE = 20;

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

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function getBearingDegrees(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const phi1 = toRadians(fromLat);
  const phi2 = toRadians(toLat);
  const lambdaDelta = toRadians(toLon - fromLon);

  const y = Math.sin(lambdaDelta) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambdaDelta);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)}m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)}km`;
}

export default function VenueSearch({ onSelect, initialLat, initialLon }: VenueSearchProps) {
  const prefetched = useLocation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NearbyVenue[]>([]);
  const [searchMode, setSearchMode] = useState<'nearby' | 'remote'>('nearby');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [remoteCoords, setRemoteCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [mapSearchQuery, setMapSearchQuery] = useState('');
  const [mapSearchLoading, setMapSearchLoading] = useState(false);
  const [mapSearchResults, setMapSearchResults] = useState<PlaceSearchResult[]>([]);
  const [categories, setCategories] = useState<VenueCategory[]>([]);
  const [selectedNearbyMarkerId, setSelectedNearbyMarkerId] = useState<string | null>(null);
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
  const requestIdRef = useRef(0);
  const customAddressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customAddressRequestIdRef = useRef(0);
  const effectiveCoords = searchMode === 'remote' ? remoteCoords : coords;
  const remoteMapCenter = useMemo<[number, number] | null>(() => {
    if (searchMode !== 'remote' || !effectiveCoords) return null;
    return [effectiveCoords.lat, effectiveCoords.lon];
  }, [searchMode, effectiveCoords?.lat, effectiveCoords?.lon]);
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

  const nearbyMapMarkers = useMemo(() => {
    const venueMarkers = results.map((venue) => ({
      lat: venue.latitude,
      lng: venue.longitude,
      label: venue.name,
      id: getVenueKey(venue),
      variant: selectedNearbyMarkerId === getVenueKey(venue) ? 'selected' as const : 'default' as const,
    }));

    if (!coords) return venueMarkers;

    return [
      {
        lat: coords.lat,
        lng: coords.lon,
        label: 'Your current location',
        variant: 'current' as const,
      },
      ...venueMarkers,
    ];
  }, [results, coords, getVenueKey, selectedNearbyMarkerId]);

  useEffect(() => {
    if (!selectedNearbyMarkerId) return;
    if (venuesByMarkerId.has(selectedNearbyMarkerId)) return;
    setSelectedNearbyMarkerId(null);
  }, [venuesByMarkerId, selectedNearbyMarkerId]);

  // Determine coordinates from explicit params or LocationContext prefetch.
  // Avoid a second geolocation flow here, which can duplicate nearby requests.
  useEffect(() => {
    if (initialLat !== undefined && initialLon !== undefined) {
      setCoords({ lat: initialLat, lon: initialLon });
      setRemoteCoords((prev) => prev ?? { lat: initialLat, lon: initialLon });
      return;
    }
    // Use prefetched coords if available
    if (prefetched.coords) {
      setCoords(prefetched.coords);
      setRemoteCoords((prev) => prev ?? prefetched.coords);
      // Use prefetched venues as initial results
      if (prefetched.nearbyVenues && !usedPrefetchRef.current) {
        usedPrefetchRef.current = true;
        setResults(prefetched.nearbyVenues);
        setHasMoreResults(prefetched.nearbyVenues.length === NEARBY_PAGE_SIZE);
      }
      return;
    }
    // Wait for LocationContext to resolve coordinates.
    setCoords(null);
  }, [initialLat, initialLon, prefetched.coords, prefetched.nearbyVenues]);

  useEffect(() => {
    if (searchMode === 'remote' && !remoteCoords && coords) {
      setRemoteCoords(coords);
    }
  }, [searchMode, remoteCoords, coords]);

  // Load categories for custom venue form
  useEffect(() => {
    venues.categories().then(setCategories).catch(() => { });
  }, []);

  // Keep default custom venue coordinates in sync with detected/prefetched coords.
  useEffect(() => {
    if (!effectiveCoords) return;
    setCustomLat((prev) => prev ?? effectiveCoords.lat);
    setCustomLng((prev) => prev ?? effectiveCoords.lon);
  }, [effectiveCoords]);

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

  const searchNearby = useCallback(
    async (searchQuery: string, offset = 0, append = false) => {
      if (!effectiveCoords) return;
      const requestId = ++requestIdRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const params: Record<string, string> = {
          lat: effectiveCoords.lat.toString(),
          lon: effectiveCoords.lon.toString(),
          limit: NEARBY_PAGE_SIZE.toString(),
          offset: offset.toString(),
        };
        if (searchQuery.trim()) {
          params.search = searchQuery.trim();
        }
        const data = await venues.nearby(params);
        if (requestId !== requestIdRef.current) return;
        if (append) {
          setResults((prev) => {
            const merged = [...prev, ...data];
            const deduped = new Map<string, NearbyVenue>();
            merged.forEach((venue) => deduped.set(getVenueKey(venue), venue));
            return Array.from(deduped.values());
          });
        } else {
          setResults(data);
        }
        setHasMoreResults(data.length === NEARBY_PAGE_SIZE);
      } catch {
        if (requestId !== requestIdRef.current) return;
        if (!append) {
          setResults([]);
        }
        setHasMoreResults(false);
      } finally {
        if (requestId !== requestIdRef.current) return;
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [effectiveCoords, getVenueKey]
  );

  // Debounced search
  useEffect(() => {
    if (!effectiveCoords) return;
    const isEmptyQuery = !query.trim();
    const hasInitialCoords = initialLat !== undefined && initialLon !== undefined;
    const usesNearbyPrefetch = searchMode === 'nearby';
    const searchDelayMs = searchMode === 'remote' ? 1000 : (isEmptyQuery ? 0 : 300);

    // For the default check-in flow, initial nearby data comes from LocationContext prefetch.
    // Skip firing a duplicate empty-query fetch from this component.
    if (usesNearbyPrefetch && isEmptyQuery && !hasInitialCoords) {
      if (prefetched.loading || prefetched.nearbyVenues) {
        return;
      }
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchNearby(query, 0, false);
    }, searchDelayMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    query,
    effectiveCoords,
    searchNearby,
    searchMode,
    initialLat,
    initialLon,
    prefetched.loading,
    prefetched.nearbyVenues,
  ]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMoreResults) return;
    searchNearby(query, results.length, true);
  }, [loading, loadingMore, hasMoreResults, searchNearby, query, results.length]);

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
        setRemoteCoords({ lat: places[0].latitude, lon: places[0].longitude });
      } else {
        setLocationError('No matching places found. Try a more specific place name.');
      }
    } catch {
      setMapSearchResults([]);
      setLocationError('Failed to search places. Please try again.');
    } finally {
      setMapSearchLoading(false);
    }
  }, [mapSearchQuery]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setSearchMode('nearby');
              setResults([]);
              setHasMoreResults(false);
            }}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${searchMode === 'nearby'
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
          >
            Near Me
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchMode('remote');
              setResults([]);
              setHasMoreResults(false);
              if (!remoteCoords && coords) {
                setRemoteCoords(coords);
              }
            }}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors ${searchMode === 'remote'
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
              : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
          >
            Elsewhere
          </button>
        </div>
      </div>

      {searchMode === 'nearby' && (
        <div className="space-y-2 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
              Near Me search center
            </span>
            {coords ? (
              <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
              </span>
            ) : (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {prefetched.loading ? 'Detecting location...' : 'Location unavailable'}
              </span>
            )}
          </div>
            {coords && nearbyMapMarkers.length > 0 ? (
            <div className="h-48 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <MapView
                center={[coords.lat, coords.lon]}
                zoom={15}
                  markers={nearbyMapMarkers}
                  selectedMarkerId={selectedNearbyMarkerId ?? undefined}
                  onMarkerSelect={handleMapMarkerSelect}
                  onMarkerClick={handleMapMarkerConfirm}
                className="h-48 w-full"
              />
            </div>
          ) : null}
            {coords && results.length > 0 && (
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Tip: click a pin to highlight it, then use the popup to select the venue.
              </p>
            )}
        </div>
      )}

      {searchMode === 'remote' && effectiveCoords && (
        <div className="space-y-1.5 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
          <div className="flex items-center gap-2">
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
                placeholder="Search city or place (e.g. Emei Philadelphia)"
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
          {mapSearchResults.length > 0 && (
            <ul className="max-h-28 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-md">
              {mapSearchResults.map((place, idx) => (
                <li key={`${place.name}:${place.latitude}:${place.longitude}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setLocationError(null);
                      setRemoteCoords({ lat: place.latitude, lon: place.longitude });
                    }}
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
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">Search center</span>
            <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
              {effectiveCoords.lat.toFixed(5)}, {effectiveCoords.lon.toFixed(5)}
            </span>
          </div>
          <div className="h-48 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <VenueEditMap
              initialCenter={[effectiveCoords.lat, effectiveCoords.lon]}
              viewCenter={remoteMapCenter}
              zoom={13}
              onChange={(lat, lng) => setRemoteCoords({ lat, lon: lng })}
              className="h-48 w-full"
            />
          </div>
        </div>
      )}

      {/* Search input */}
      <div className="relative">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchMode === 'remote' ? 'Search venues near selected map area...' : 'Search nearby venues...'}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {locationError && (
        <p className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded-md px-3 py-2">
          {locationError}
        </p>
      )}

      {/* Results list */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-3 justify-center">
          <Loader2 size={16} className="animate-spin" />
          {searchMode === 'remote' ? 'Searching selected area...' : 'Searching nearby...'}
        </div>
      )}

      {!loading && results.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
          {results.map((venue) => (
            (() => {
              const distanceMeters = effectiveCoords
                ? haversineDistance(effectiveCoords.lat, effectiveCoords.lon, venue.latitude, venue.longitude)
                : null;
              const bearing = effectiveCoords
                ? getBearingDegrees(effectiveCoords.lat, effectiveCoords.lon, venue.latitude, venue.longitude)
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
                        <Navigation
                          size={10}
                          className="text-gray-500 dark:text-gray-400"
                          style={{ transform: `rotate(${bearing}deg)` }}
                        />
                        <span>{formatDistance(distanceMeters)}</span>
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

      {!loading && results.length === 0 && effectiveCoords && query && (
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
            if (effectiveCoords) {
              setCustomLat(effectiveCoords.lat);
              setCustomLng(effectiveCoords.lon);
            }
          }}
          className="flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
        >
          <Plus size={14} />
          Create Custom Venue
        </button>
      ) : (
        <form
          onSubmit={handleCreateCustom}
          className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3 bg-gray-50 dark:bg-gray-800"
        >
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            New Custom Venue
          </h4>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Venue name *"
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
              <div className="h-56 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                <VenueEditMap
                  initialCenter={[customLat, customLng]}
                  viewCenter={customMapCenter}
                  zoom={15}
                  onChange={(lat, lng) => {
                    setCustomLat(lat);
                    setCustomLng(lng);
                  }}
                  className="h-56 w-full"
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
  );
}
