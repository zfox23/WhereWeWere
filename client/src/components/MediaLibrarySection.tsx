import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { media } from '../api/client';
import Stars from './Stars';
import {
  MEDIA_SUBTYPES,
  MEDIA_SUBTYPE_LIST,
  CHECKIN_TYPE_LABELS,
  formatCheckinDate,
} from '../utils/media';
import { slugify } from '../utils/slugify';
import type { MediaLibraryItem, MediaSubtype } from '../types';

const BADGE_CLASSES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  dropped: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

function getSelectedTypesFromLocation(): MediaSubtype[] {
  const param = new URLSearchParams(window.location.search).get('mediaTypes');
  if (!param) return MEDIA_SUBTYPE_LIST;
  const parsed = param
    .split(',')
    .map((t) => t.trim())
    .filter((t): t is MediaSubtype => (MEDIA_SUBTYPES as Record<string, unknown>)[t] !== undefined);
  return parsed.length > 0 ? parsed : MEDIA_SUBTYPE_LIST;
}

interface MediaLibrarySectionProps {
  from: string;
  to: string;
}

type SortKey = 'rating' | 'checkin' | 'completed';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'rating', label: 'Rating' },
  { value: 'checkin', label: 'Last check-in' },
  { value: 'completed', label: 'Completed count' },
];

function sortValue(item: MediaLibraryItem, key: SortKey): number {
  switch (key) {
    case 'rating':
      return item.latest_rating ?? -Infinity;
    case 'checkin':
      return new Date(item.last_checkin_at).getTime();
    case 'completed':
      return item.completed_count ?? 0;
  }
}

export function MediaLibrarySection({ from, to }: MediaLibrarySectionProps) {
  const [selectedTypes, setSelectedTypes] = useState<MediaSubtype[]>(getSelectedTypesFromLocation);
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('checkin');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const activeTypes = useMemo(
    () => MEDIA_SUBTYPE_LIST.filter((t) => selectedTypes.includes(t)),
    [selectedTypes]
  );

  const toggleType = (type: MediaSubtype) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  // Keep state in sync when the URL changes (back/forward navigation).
  useEffect(() => {
    const syncFromLocation = () => {
      setSelectedTypes(getSelectedTypesFromLocation());
    };
    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener('hashchange', syncFromLocation);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener('hashchange', syncFromLocation);
    };
  }, []);

  // Persist the type selection to the URL, matching the tab's replaceState pattern.
  useEffect(() => {
    const url = new URL(window.location.href);
    const current = url.searchParams.get('mediaTypes');
    const next = selectedTypes.join(',');
    if (current === next) return;
    if (selectedTypes.length === MEDIA_SUBTYPE_LIST.length) {
      url.searchParams.delete('mediaTypes');
    } else {
      url.searchParams.set('mediaTypes', next);
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [selectedTypes]);

  const sortedItems = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      const va = sortValue(a, sortBy);
      const vb = sortValue(b, sortBy);
      // Both null ratings compare equal (avoid Infinity - Infinity = NaN).
      if (va === vb) {
        const ts = new Date(b.last_checkin_at).getTime() - new Date(a.last_checkin_at).getTime();
        if (ts !== 0) return ts;
        return a.title.localeCompare(b.title);
      }
      const diff = va - vb;
      return sortDir === 'asc' ? diff : -diff;
    });
    return sorted;
  }, [items, sortBy, sortDir]);

  const toggleDirection = () => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));

  useEffect(() => {
    if (activeTypes.length === 0) {
      setItems([]);
      setLoading(false);
      setInitialLoaded(true);
      return;
    }

    let cancelled = false;
    setLoading(true);
    media
      .library(from || undefined, to || undefined, activeTypes)
      .then((data) => {
        if (cancelled) return;
        setItems(data);
      })
      .catch((err) => {
        console.error('Failed to load media library:', err);
        if (cancelled) return;
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setInitialLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [from, to, activeTypes]);

  if (!initialLoaded) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="animate-spin text-primary-600" size={24} />
      </div>
    );
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Library</h3>
        <div className="flex items-center gap-1.5">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            aria-label="Sort library by"
            className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={toggleDirection}
            aria-label={sortDir === 'asc' ? 'Sort descending' : 'Sort ascending'}
            title={sortDir === 'asc' ? 'Currently ascending — click for descending' : 'Currently descending — click for ascending'}
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>
        </div>
      </div>

      {/* Media type filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {MEDIA_SUBTYPE_LIST.map((type) => {
          const config = MEDIA_SUBTYPES[type];
          const active = selectedTypes.includes(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              aria-pressed={active}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                active
                  ? 'bg-primary-500 border-primary-500 text-white'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {config.plural}
            </button>
          );
        })}
      </div>

      {activeTypes.length === 0 ? (
        <p className="text-sm text-gray-400">Select at least one media type to view.</p>
      ) : loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">No media checked in during this period.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {sortedItems.map((item) => {
            const config = MEDIA_SUBTYPES[item.media_type] || MEDIA_SUBTYPES.movie;
            const href = `${config.detailBase}/${item.id}/${item.title ? slugify(item.title) : ''}`;
            return (
              <Link
                key={item.id}
                to={href}
                className="group bg-white/70 dark:bg-gray-900/70 rounded-xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-2.5 hover:ring-2 hover:ring-primary-400 transition-shadow"
              >
                <div className="relative">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt=""
                      className="w-full aspect-[2/3] object-cover rounded-lg shadow-sm"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full aspect-[2/3] rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-3xl">
                      {config.icon}
                    </div>
                  )}
                  <span
                    className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                      BADGE_CLASSES[item.last_checkin_type] || BADGE_CLASSES.completed
                    }`}
                  >
                    {CHECKIN_TYPE_LABELS[item.last_checkin_type] || item.last_checkin_type}
                  </span>
                </div>
                <p className="mt-2 text-xs font-semibold text-gray-800 dark:text-gray-200 leading-tight line-clamp-2 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                  {item.title}
                </p>
                {item.author && (
                  <p className="text-[11px] text-gray-400 truncate">{item.author}</p>
                )}
                <div className="mt-1 flex items-center justify-between gap-1">
                  {item.latest_rating != null && item.latest_rating > 0 ? (
                    <Stars value={item.latest_rating} size={11} />
                  ) : (
                    <span />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-gray-400 truncate" title={formatCheckinDate(item.last_checkin_at, item.last_checkin_timezone)}>
                  {formatCheckinDate(item.last_checkin_at, item.last_checkin_timezone)}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
