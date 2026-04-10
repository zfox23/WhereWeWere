import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { venues } from '../api/client';
import { haversineDistance } from '../utils/geo';
import type { NearbyVenue } from '../types';

const STALE_DISTANCE_M = 200;
const PREFETCH_LIMIT = '20';
const PREFETCH_OFFSET = '0';
const PREFETCH_CACHE_TTL_MS = 30 * 1000;

const nearbyPrefetchInflight = new Map<string, Promise<NearbyVenue[]>>();
const nearbyPrefetchCache = new Map<string, { data: NearbyVenue[]; expiresAt: number }>();

function buildNearbyPrefetchKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}|${PREFETCH_LIMIT}|${PREFETCH_OFFSET}`;
}

function fetchNearbyPrefetch(lat: number, lon: number): Promise<NearbyVenue[]> {
  const key = buildNearbyPrefetchKey(lat, lon);
  const cached = nearbyPrefetchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data);
  }

  const existing = nearbyPrefetchInflight.get(key);
  if (existing) return existing;

  const request = venues.nearby({
    lat: lat.toString(),
    lon: lon.toString(),
    limit: PREFETCH_LIMIT,
    offset: PREFETCH_OFFSET,
  }).then((data) => {
    nearbyPrefetchCache.set(key, {
      data,
      expiresAt: Date.now() + PREFETCH_CACHE_TTL_MS,
    });
    return data;
  }).finally(() => {
    nearbyPrefetchInflight.delete(key);
  });

  nearbyPrefetchInflight.set(key, request);
  return request;
}

interface LocationState {
  coords: { lat: number; lon: number } | null;
  nearbyVenues: NearbyVenue[] | null;
  loading: boolean;
  refetch: () => Promise<{ lat: number; lon: number } | null>;
}

const LocationContext = createContext<LocationState>({
  coords: null,
  nearbyVenues: null,
  loading: false,
  refetch: async () => null,
});

export function useLocation() {
  return useContext(LocationContext);
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [nearbyVenues, setNearbyVenues] = useState<NearbyVenue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedCoordsRef = useRef<{ lat: number; lon: number } | null>(null);

  // Request geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  // Prefetch nearby venues when coords become available
  useEffect(() => {
    if (!coords) return;
    // Skip if we already fetched for a nearby position
    if (fetchedCoordsRef.current) {
      const dist = haversineDistance(
        fetchedCoordsRef.current.lat, fetchedCoordsRef.current.lon,
        coords.lat, coords.lon
      );
      if (dist < STALE_DISTANCE_M) return;
    }
    setLoading(true);
    fetchNearbyPrefetch(coords.lat, coords.lon)
      .then((data) => {
        setNearbyVenues(data);
        fetchedCoordsRef.current = coords;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [coords]);

  const refetch = useCallback(async () => {
    if (!navigator.geolocation) return null;
    return new Promise<{ lat: number; lon: number } | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const newCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setCoords(newCoords);
          // Force refetch by clearing fetchedCoords
          fetchedCoordsRef.current = null;
          resolve(newCoords);
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }, []);

  return (
    <LocationContext.Provider value={{ coords, nearbyVenues, loading, refetch }}>
      {children}
    </LocationContext.Provider>
  );
}
