import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Search as SearchIcon, MapPin, Tag, Navigation, Loader2 } from 'lucide-react';
import { search } from '../api/client';
import { Venue, CheckIn, SearchResults } from '../types';
import CheckInCard from '../components/CheckInCard';

type FilterType = 'all' | 'venues' | 'checkins';

export default function Search() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = useCallback(
    async (q: string, type: FilterType) => {
      if (!q.trim()) {
        setResults(null);
        setHasSearched(false);
        return;
      }

      setLoading(true);
      setError(null);
      setHasSearched(true);

      try {
        const data = await search.query(q.trim(), type, 20);
        setResults(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults(null);
      setHasSearched(false);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query, filter);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, filter, performSearch]);

  const filterTabs: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'venues', label: 'Venues' },
    { key: 'checkins', label: 'Check-ins' },
  ];

  const venueResults = results?.venues ?? [];
  const checkinResults = results?.checkins ?? [];
  const hasResults = venueResults.length > 0 || checkinResults.length > 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Search</h1>

      {/* Search Input */}
      <div className="relative">
        <SearchIcon
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search venues and check-ins..."
          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          autoFocus
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              filter === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-primary-600" size={32} />
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-red-600">{error}</p>
        </div>
      ) : !hasSearched ? (
        <div className="text-center py-16">
          <SearchIcon size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Start typing to search...</p>
        </div>
      ) : !hasResults ? (
        <div className="text-center py-16">
          <SearchIcon size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No results found for "{query}"</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Venue Results */}
          {venueResults.length > 0 && (filter === 'all' || filter === 'venues') && (
            <div>
              {filter === 'all' && (
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Venues
                </h2>
              )}
              <div className="space-y-2">
                {venueResults.map((venue: Venue) => (
                  <Link
                    key={venue.id}
                    to={`/venues/${venue.id}`}
                    className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-primary-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-primary-50 rounded-lg mt-0.5">
                        <MapPin size={16} className="text-primary-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900 truncate">
                          {venue.name}
                        </p>
                        {venue.category_name && (
                          <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                            <Tag size={12} />
                            <span>{venue.category_name}</span>
                          </div>
                        )}
                        {(venue.address || venue.city) && (
                          <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                            <Navigation size={12} />
                            <span className="truncate">
                              {[venue.address, venue.city, venue.state]
                                .filter(Boolean)
                                .join(', ')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Check-in Results */}
          {checkinResults.length > 0 && (filter === 'all' || filter === 'checkins') && (
            <div>
              {filter === 'all' && (
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Check-ins
                </h2>
              )}
              <div className="space-y-3">
                {checkinResults.map((checkin: CheckIn) => (
                  <CheckInCard key={checkin.id} checkin={checkin} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
