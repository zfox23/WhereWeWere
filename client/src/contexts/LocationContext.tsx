import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { venues } from '../api/client';
import { haversineDistance } from '../utils/geo';
import type { NearbyVenue } from '../types';

const STALE_DISTANCE_M = 200;

interface LocationState {
  coords: { lat: number; lon: number } | null;
  nearbyVenues: NearbyVenue[] | null;
  loading: boolean;
  refetch: () => void;
}

const LocationContext = createContext<LocationState>({
  coords: null,
  nearbyVenues: null,
  loading: false,
  refetch: () => {},
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
    venues.nearby({ lat: coords.lat.toString(), lon: coords.lon.toString() })
      .then((data) => {
        setNearbyVenues(data);
        fetchedCoordsRef.current = coords;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [coords]);

  const refetch = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setCoords(newCoords);
        // Force refetch by clearing fetchedCoords
        fetchedCoordsRef.current = null;
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return (
    <LocationContext.Provider value={{ coords, nearbyVenues, loading, refetch }}>
      {children}
    </LocationContext.Provider>
  );
}
