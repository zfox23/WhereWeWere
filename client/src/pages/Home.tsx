import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, Plus, Loader2, MapPin, X, Smile } from 'lucide-react';
import { timeline as timelineApi, settings, scrobbles as scrobblesApi, immich as immichApi } from '../api/client';
import { Scrobble, ImmichAsset, TimelineItem } from '../types';
import CheckInCard from '../components/CheckInCard';
import MoodCheckInCard from '../components/MoodCheckInCard';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const PAGE_SIZE = 20;

function formatDateHeader(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(dateStr + 'T12:00:00'));
}

function groupByDate(items: TimelineItem[]): Map<string, TimelineItem[]> {
  const groups = new Map<string, TimelineItem[]>();
  for (const item of items) {
    const date = item.checked_in_at.slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(item);
  }
  return groups;
}

function fillDateGaps(grouped: Map<string, TimelineItem[]>): Map<string, TimelineItem[]> {
  const dates = Array.from(grouped.keys()).sort();
  if (dates.length < 2) return grouped;
  const filled = new Map<string, TimelineItem[]>();
  const start = new Date(dates[0] + 'T12:00:00');
  const end = new Date(dates[dates.length - 1] + 'T12:00:00');
  for (let d = new Date(end); d >= start; d.setDate(d.getDate() - 1)) {
    const key = d.toISOString().slice(0, 10);
    filled.set(key, grouped.get(key) || []);
  }
  return filled;
}

function buildDawarichDayUrl(dawarichUrl: string, date: string): string {
  const start = encodeURIComponent(encodeURIComponent(date + 'T00:00'));
  const end = encodeURIComponent(encodeURIComponent(date + 'T23:59'));
  return `${dawarichUrl}/map/v2?start_at=${start}&end_at=${end}`;
}

function ExpandableFAB() {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        />
      )}

      {expanded && (
        <div className="fixed bottom-36 md:bottom-24 right-4 md:right-6 z-40 flex flex-col gap-3 items-end animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Link
            to="/mood-check-in"
            onClick={() => setExpanded(false)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm font-medium"
          >
            <Smile size={18} className="text-green-500" />
            Mood
          </Link>
          <Link
            to="/check-in"
            onClick={() => setExpanded(false)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm font-medium"
          >
            <MapPin size={18} className="text-primary-500" />
            Location
          </Link>
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 w-14 h-14 bg-gradient-to-br from-primary-500 to-primary-700 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/30 hover:shadow-xl hover:shadow-primary-500/40 hover:scale-105 transition-all"
      >
        <Plus
          size={24}
          className="transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(45deg)' : 'none' }}
        />
      </button>
    </>
  );
}

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [malojaUrl, setMalojaUrl] = useState<string | null>(null);
  const [dawarichUrl, setDawarichUrl] = useState<string | null>(null);
  const [iconPack, setIconPack] = useState('emoji');
  const [scrobblesMap, setScrobblesMap] = useState<Record<string, Scrobble[]>>({});
  const [photosMap, setPhotosMap] = useState<Record<string, ImmichAsset[]>>({});

  // Fetch integration URLs from settings
  useEffect(() => {
    settings.get().then((s) => {
      if (s.immich_url) setImmichUrl(s.immich_url.replace(/\/+$/, ''));
      if (s.maloja_url) setMalojaUrl(s.maloja_url.replace(/\/+$/, ''));
      if (s.dawarich_url) setDawarichUrl(s.dawarich_url.replace(/\/+$/, ''));
      if (s.mood_icon_pack) setIconPack(s.mood_icon_pack);
    }).catch(() => {});
  }, []);

  // Read filters from URL params
  const searchQuery = searchParams.get('q') || '';
  const fromDate = searchParams.get('from') || '';
  const toDate = searchParams.get('to') || '';
  const venueId = searchParams.get('venue_id') || '';
  const category = searchParams.get('category') || '';
  const country = searchParams.get('country') || '';

  const [showFilters, setShowFilters] = useState(false);

  // Show filters panel if any structured filter is active
  useEffect(() => {
    if (fromDate || toDate || venueId || category || country) {
      setShowFilters(true);
    }
  }, []);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef = useRef(0);

  const setFilter = useCallback((key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const fetchTimeline = useCallback(
    async (offset: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const params: Record<string, string> = {
          user_id: USER_ID,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        };
        if (searchQuery.trim()) params.q = searchQuery.trim();
        if (fromDate) params.from = fromDate;
        if (toDate) params.to = toDate + 'T23:59:59';
        if (venueId) params.venue_id = venueId;
        if (category) params.category = category;
        if (country) params.country = country;

        const data = await timelineApi.list(params);
        if (append) {
          setItems((prev) => [...prev, ...data]);
        } else {
          setItems(data);
        }
        setHasMore(data.length === PAGE_SIZE);
        offsetRef.current = offset + data.length;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load check-ins');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [searchQuery, fromDate, toDate, venueId, category, country]
  );

  // Initial load + reload on filter changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      offsetRef.current = 0;
      fetchTimeline(0, false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchTimeline]);

  // Location items for scrobbles/photos
  const locationItems = useMemo(
    () => items.filter(i => i.type === 'location'),
    [items]
  );

  // Fetch scrobbles for loaded location check-ins
  useEffect(() => {
    if (!malojaUrl || locationItems.length === 0) return;
    const newIds = locationItems.map((c) => c.id).filter((id) => !(id in scrobblesMap));
    if (newIds.length === 0) return;
    scrobblesApi.forCheckins(newIds).then((data) => {
      setScrobblesMap((prev) => ({ ...prev, ...data }));
    }).catch(() => {});
  }, [locationItems, malojaUrl]);

  // Deduplicate scrobbles across checkins: assign each scrobble to the closest checkin
  const dedupedScrobblesMap = useMemo(() => {
    if (locationItems.length <= 1) return scrobblesMap;
    const assignments: Map<number, { checkinId: string; checkinTimeMs: number; scrobble: Scrobble }[]> = new Map();
    for (const item of locationItems) {
      const scrobbleList = scrobblesMap[item.id];
      if (!scrobbleList) continue;
      const checkinTimeMs = new Date(item.checked_in_at).getTime();
      for (const s of scrobbleList) {
        const key = s.time;
        if (!assignments.has(key)) assignments.set(key, []);
        assignments.get(key)!.push({ checkinId: item.id, checkinTimeMs, scrobble: s });
      }
    }
    const result: Record<string, Scrobble[]> = {};
    for (const id of Object.keys(scrobblesMap)) {
      result[id] = [];
    }
    for (const [, entries] of assignments) {
      let best = entries[0];
      for (const entry of entries) {
        if (Math.abs(entry.scrobble.time * 1000 - entry.checkinTimeMs) < Math.abs(best.scrobble.time * 1000 - best.checkinTimeMs)) {
          best = entry;
        }
      }
      if (!result[best.checkinId]) result[best.checkinId] = [];
      result[best.checkinId].push(best.scrobble);
    }
    for (const id of Object.keys(result)) {
      result[id].sort((a, b) => a.time - b.time);
    }
    return result;
  }, [scrobblesMap, locationItems]);

  // Fetch photos for loaded location check-ins (batch with deduplication)
  useEffect(() => {
    if (!immichUrl || locationItems.length === 0) return;
    const newIds = locationItems.map((c) => c.id).filter((id) => !(id in photosMap));
    if (newIds.length === 0) return;
    immichApi.photosForCheckins(newIds).then((data) => {
      setPhotosMap((prev) => ({ ...prev, ...data }));
    }).catch(() => {});
  }, [locationItems, immichUrl]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
          fetchTimeline(offsetRef.current, true);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, fetchTimeline]);

  const clearFilters = () => {
    setSearchParams({}, { replace: true });
    setShowFilters(false);
  };

  const hasActiveFilters = searchQuery || fromDate || toDate || venueId || category || country;
  const rawGrouped = groupByDate(items);
  const grouped = dawarichUrl && !hasActiveFilters ? fillDateGaps(rawGrouped) : rawGrouped;

  // Build active filter pills for display
  const filterPills: { label: string; key: string }[] = [];
  if (venueId) {
    const locationItem = items.find(i => i.type === 'location');
    filterPills.push({ label: `Venue: ${locationItem?.venue_name || venueId}`, key: 'venue_id' });
  }
  if (category) filterPills.push({ label: `Category: ${category}`, key: 'category' });
  if (country) filterPills.push({ label: `Country: ${country}`, key: 'country' });
  if (fromDate && toDate && fromDate === toDate) {
    filterPills.push({ label: `Date: ${fromDate}`, key: 'from' });
  } else {
    if (fromDate) filterPills.push({ label: `From: ${fromDate}`, key: 'from' });
    if (toDate) filterPills.push({ label: `Until: ${toDate}`, key: 'to' });
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setFilter('q', e.target.value)}
            placeholder="Search venues and notes..."
            className="w-full pl-10 pr-4 py-3 bg-white/70 dark:bg-gray-900/70 backdrop-blur-xl border border-white/40 dark:border-gray-700/40 rounded-2xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none shadow-sm shadow-black/[0.03] dark:text-gray-100"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-3 rounded-2xl border transition-all backdrop-blur-xl ${
            showFilters || hasActiveFilters
              ? 'bg-primary-50/70 border-primary-300/60 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'bg-white/70 dark:bg-gray-900/70 border-white/40 dark:border-gray-700/40 text-gray-600 dark:text-gray-400 hover:bg-white/90 dark:hover:bg-gray-800/90 shadow-sm shadow-black/[0.03]'
          }`}
        >
          <SlidersHorizontal size={18} />
        </button>
      </div>

      {/* Active filter pills */}
      {filterPills.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filterPills.map((pill) => (
            <span
              key={pill.key}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded-full text-xs font-medium"
            >
              {pill.label}
              <button
                onClick={() => {
                  if (pill.key === 'from' && fromDate === toDate) {
                    setSearchParams((prev) => {
                      const next = new URLSearchParams(prev);
                      next.delete('from');
                      next.delete('to');
                      return next;
                    }, { replace: true });
                  } else {
                    setFilter(pill.key, '');
                  }
                }}
                className="hover:text-primary-900 ml-0.5"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {filterPills.length > 1 && (
            <button
              onClick={clearFilters}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Expanded filters */}
      {showFilters && (
        <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters</span>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                <X size={12} />
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">After</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFilter('from', e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Before</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setFilter('to', e.target.value)}
                className="input"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setFilter('category', e.target.value)}
                className="input"
                placeholder="e.g. Restaurant"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Country</label>
              <input
                type="text"
                value={country}
                onChange={(e) => setFilter('country', e.target.value)}
                className="input"
                placeholder="e.g. United States"
              />
            </div>
          </div>
        </div>
      )}

      {/* Feed */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-primary-600" size={32} />
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={() => fetchTimeline(0, false)}
            className="btn-primary"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-8 text-center">
          <MapPin size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-4">
            {hasActiveFilters ? 'No check-ins match your filters.' : 'No check-ins yet. Start exploring!'}
          </p>
          {!hasActiveFilters && (
            <Link to="/check-in" className="btn-primary">
              <MapPin size={18} className="mr-2" />
              First Check In
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-0">
          {Array.from(grouped.entries()).map(([date, dateItems]) => (
            <div key={date} className="relative">
              {/* Date header with timeline dot */}
              <div className="flex items-center gap-3 py-2">
                <div className="w-3 h-3 rounded-full bg-primary-500 shrink-0 ring-4 ring-primary-100 dark:ring-primary-900/30 relative z-10" />
                <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  {dawarichUrl ? (
                    <a
                      href={buildDawarichDayUrl(dawarichUrl, date)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                    >
                      {formatDateHeader(date)}
                    </a>
                  ) : (
                    formatDateHeader(date)
                  )}
                </h2>
              </div>
              {/* Cards with vertical line */}
              {dateItems.length > 0 ? (
                <div className="ml-[5px] border-l-2 border-gray-200 dark:border-gray-700 pl-6 pb-4 space-y-3">
                  {dateItems.map((item) =>
                    item.type === 'mood' ? (
                      <MoodCheckInCard
                        key={item.id}
                        item={item}
                        iconPack={iconPack}
                      />
                    ) : (
                      <CheckInCard
                        key={item.id}
                        checkin={{
                          id: item.id,
                          user_id: item.user_id,
                          venue_id: item.venue_id!,
                          venue_name: item.venue_name,
                          venue_category: item.venue_category,
                          venue_latitude: item.venue_latitude,
                          venue_longitude: item.venue_longitude,
                          venue_timezone: item.venue_timezone,
                          parent_venue_id: item.parent_venue_id,
                          parent_venue_name: item.parent_venue_name,
                          notes: item.notes,
                          rating: item.rating ?? null,
                          checked_in_at: item.checked_in_at,
                          created_at: item.created_at,
                        }}
                        immichUrl={immichUrl}
                        photos={photosMap[item.id] ?? null}
                        scrobbles={dedupedScrobblesMap[item.id]}
                        malojaUrl={malojaUrl}
                        dawarichUrl={dawarichUrl}
                      />
                    )
                  )}
                </div>
              ) : (
                <div className="ml-[5px] border-l-2 border-gray-200 dark:border-gray-700 pl-6 pb-4">
                  <p className="text-xs text-gray-400 dark:text-gray-500 italic">No check-ins</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-4" />
      {loadingMore && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="animate-spin text-gray-400" size={24} />
        </div>
      )}

      {/* FAB */}
      <ExpandableFAB />
    </div>
  );
}
