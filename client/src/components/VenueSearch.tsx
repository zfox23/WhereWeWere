import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, MapPin, Plus, Loader2 } from 'lucide-react';
import { venues } from '../api/client';
import type { NearbyVenue, VenueCategory } from '../types';

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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NearbyVenue[]>([]);
  const [loading, setLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [categories, setCategories] = useState<VenueCategory[]>([]);

  // Custom venue form state
  const [customName, setCustomName] = useState('');
  const [customAddress, setCustomAddress] = useState('');
  const [customCategoryId, setCustomCategoryId] = useState('');
  const [creatingCustom, setCreatingCustom] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get user geolocation on mount (or use provided initial coords)
  useEffect(() => {
    if (initialLat !== undefined && initialLon !== undefined) {
      setCoords({ lat: initialLat, lon: initialLon });
      return;
    }
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      },
      (err) => {
        setLocationError(`Location access denied: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [initialLat, initialLon]);

  // Load categories for custom venue form
  useEffect(() => {
    venues.categories().then(setCategories).catch(() => {});
  }, []);

  const searchNearby = useCallback(
    async (searchQuery: string) => {
      if (!coords) return;
      setLoading(true);
      try {
        const params: Record<string, string> = {
          lat: coords.lat.toString(),
          lon: coords.lon.toString(),
        };
        if (searchQuery.trim()) {
          params.q = searchQuery.trim();
        }
        const data = await venues.nearby(params);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [coords]
  );

  // Fetch nearby venues when coords are available
  useEffect(() => {
    if (coords) {
      searchNearby('');
    }
  }, [coords, searchNearby]);

  // Debounced search
  useEffect(() => {
    if (!coords) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchNearby(query);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, coords, searchNearby]);

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

  const handleCreateCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !coords) return;
    setCreatingCustom(true);
    try {
      const created = await venues.create({
        name: customName.trim(),
        address: customAddress.trim() || null,
        category_id: customCategoryId || null,
        latitude: coords.lat,
        longitude: coords.lon,
      });
      onSelect({ id: created.id, name: created.name });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create venue');
    } finally {
      setCreatingCustom(false);
    }
  };

  return (
    <div className="space-y-3">
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
          placeholder="Search nearby venues..."
          className="w-full pl-9 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {locationError && (
        <p className="text-sm text-amber-600 bg-amber-50 rounded-md px-3 py-2">
          {locationError}
        </p>
      )}

      {/* Results list */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-3 justify-center">
          <Loader2 size={16} className="animate-spin" />
          Searching nearby...
        </div>
      )}

      {!loading && results.length > 0 && (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
          {results.map((venue, i) => (
            <li key={`${venue.osm_id}-${i}`}>
              <button
                type="button"
                onClick={() =>
                  venue.source === 'local'
                    ? handleSelectLocal(venue)
                    : handleSelectOsm(venue)
                }
                disabled={importing !== null && importing === venue.osm_id}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-start gap-2.5"
              >
                <MapPin
                  size={16}
                  className="text-gray-400 mt-0.5 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900 truncate">
                      {venue.name}
                    </span>
                    <span
                      className={`shrink-0 inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${
                        venue.source === 'local'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {venue.source === 'local' ? 'Local' : 'OSM'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {[venue.category, venue.address]
                      .filter(Boolean)
                      .join(' \u00b7 ')}
                  </div>
                </div>
                {importing === venue.osm_id && (
                  <Loader2
                    size={14}
                    className="animate-spin text-gray-400 mt-1 shrink-0"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && results.length === 0 && coords && query && (
        <p className="text-sm text-gray-500 text-center py-3">
          No venues found. Try a different search or create a custom venue.
        </p>
      )}

      {/* Create custom venue toggle */}
      {!showCreateForm ? (
        <button
          type="button"
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          <Plus size={14} />
          Create Custom Venue
        </button>
      ) : (
        <form
          onSubmit={handleCreateCustom}
          className="border border-gray-200 rounded-lg p-3 space-y-3 bg-gray-50"
        >
          <h4 className="text-sm font-semibold text-gray-700">
            New Custom Venue
          </h4>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Venue name *"
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <input
            type="text"
            value={customAddress}
            onChange={(e) => setCustomAddress(e.target.value)}
            placeholder="Address (optional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {categories.length > 0 && (
            <select
              value={customCategoryId}
              onChange={(e) => setCustomCategoryId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="">Select category (optional)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!customName.trim() || creatingCustom}
              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              {creatingCustom ? 'Creating...' : 'Create Venue'}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
