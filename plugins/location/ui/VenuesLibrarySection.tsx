import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Loader2, Search, Tag } from 'lucide-react';
import { venues, venueLists } from '../../../client/src/api/client';
import { formatDate } from '../../../client/src/utils/checkin';
import Stars from '../../../client/src/components/Stars';
import type { VenueLibraryItem, VenueList } from '../../../client/src/types';

interface VenuesLibrarySectionProps {
  from: string;
  to: string;
}

type SortKey = 'name' | 'category' | 'rating' | 'checkin_count' | 'last_checkin';
type SortDir = 'asc' | 'desc';

function sortValue(item: VenueLibraryItem, key: SortKey): number {
  switch (key) {
    case 'rating':
      return item.rating ?? -Infinity;
    case 'checkin_count':
      return item.checkin_count ?? 0;
    case 'last_checkin':
      return item.last_checkin_at ? new Date(item.last_checkin_at).getTime() : -Infinity;
    default:
      return 0;
  }
}

export function VenuesLibrarySection({ from, to }: VenuesLibrarySectionProps) {
  const [items, setItems] = useState<VenueLibraryItem[]>([]);
  const [lists, setLists] = useState<VenueList[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('last_checkin');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [nameQuery, setNameQuery] = useState('');
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [categoryFocused, setCategoryFocused] = useState(false);

  // Distinct category names present in the loaded items (for autocomplete).
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      const name = item.category_name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [items]);

  const categorySuggestions = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return [];
    return categoryOptions
      .filter((c) => c.toLowerCase().includes(q))
      .slice(0, 8);
  }, [categoryOptions, categoryQuery]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    venues
      .library(from || undefined, to || undefined)
      .then((data) => {
        if (cancelled) return;
        setItems(data as VenueLibraryItem[]);
      })
      .catch((err) => {
        console.error('Failed to load venue library:', err);
        if (!cancelled) setItems([]);
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
  }, [from, to]);

  useEffect(() => {
    venueLists
      .list()
      .then((data) => setLists(data as VenueList[]))
      .catch(() => setLists([]));
  }, []);

  const selectedList = useMemo(
    () => lists.find((l) => l.id === selectedListId) ?? null,
    [lists, selectedListId]
  );

  const visibleItems = useMemo(() => {
    let filtered = items;

    // Filter by list membership.
    if (selectedList) {
      const ids = new Set(selectedList.items.map((i) => i.id));
      filtered = filtered.filter((item) => ids.has(item.id));
    }

    // Filter by name (text).
    const name = nameQuery.trim().toLowerCase();
    if (name) {
      filtered = filtered.filter((item) => item.name.toLowerCase().includes(name));
    }

    // Filter by venue category (text with autocomplete; substring match).
    const cat = categoryQuery.trim().toLowerCase();
    if (cat) {
      filtered = filtered.filter((item) =>
        item.category_name?.toLowerCase().includes(cat)
      );
    }

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp: number;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortBy === 'category') {
        cmp = (a.category_name ?? '').localeCompare(b.category_name ?? '');
      } else {
        const va = sortValue(a, sortBy);
        const vb = sortValue(b, sortBy);
        cmp = va - vb;
      }
      if (cmp === 0) {
        const ta = a.last_checkin_at ? new Date(a.last_checkin_at).getTime() : 0;
        const tb = b.last_checkin_at ? new Date(b.last_checkin_at).getTime() : 0;
        if (tb - ta !== 0) return tb - ta;
        return a.name.localeCompare(b.name);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [items, selectedList, nameQuery, categoryQuery, sortBy, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'name' || key === 'category' ? 'asc' : 'desc');
    }
  };

  const hasActiveFilter = Boolean(
    nameQuery.trim() || categoryQuery.trim() || selectedListId
  );

  const headerCell = (key: SortKey, label: string) => (
    <th
      scope="col"
      aria-sort={sortBy === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="py-2 pr-3 font-semibold first:pl-0"
    >
      <button
        type="button"
        onClick={() => handleSort(key)}
        className="inline-flex items-center gap-1 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
      >
        {label}
        {sortBy === key && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  const plainHeader = (label: string, extraClass = '') => (
    <th scope="col" className={`py-2 pr-3 font-semibold ${extraClass}`}>
      {label}
    </th>
  );

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          All Venues
          {!loading && (
            <span className="ml-2 text-xs font-normal text-gray-400">
              {visibleItems.length}{hasActiveFilter ? ` of ${items.length}` : ''}
            </span>
          )}
        </h2>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <div className="relative flex-1 min-w-[140px]">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="Filter by name…"
            aria-label="Filter venues by name"
            className="w-full text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-6 pr-2 py-1 text-gray-600 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Category filter with autocomplete */}
        <div className="relative">
          <Tag size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden />
          <input
            type="text"
            value={categoryQuery}
            onChange={(e) => setCategoryQuery(e.target.value)}
            onFocus={() => setCategoryFocused(true)}
            onBlur={() => setTimeout(() => setCategoryFocused(false), 150)}
            placeholder="Category…"
            aria-label="Filter venues by category"
            className="w-32 sm:w-40 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg pl-6 pr-2 py-1 text-gray-600 dark:text-gray-300 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {categoryFocused && categorySuggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg divide-y divide-gray-100 dark:divide-gray-700">
              {categorySuggestions.map((c) => (
                <li key={c}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setCategoryQuery(c);
                      setCategoryFocused(false);
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                  >
                    {c}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <select
          value={selectedListId ?? ''}
          onChange={(e) => setSelectedListId(e.target.value || null)}
          aria-label="Filter venues by list"
          className="text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">All lists</option>
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-primary-600" size={24} />
        </div>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-gray-400">
          {hasActiveFilter
            ? 'No venues match the current filters.'
            : from || to
              ? 'No venues checked in during this period.'
              : 'No venues in your library yet.'}
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {headerCell('name', 'Venue')}
                {headerCell('rating', 'Rating')}
                {headerCell('checkin_count', 'Check-ins')}
                {headerCell('last_checkin', 'Last check-in')}
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                >
                  <td className="py-2.5 pr-3 max-w-[18rem]">
                    <Link
                      to={`/venues/${item.id}`}
                      className="font-medium text-gray-800 dark:text-gray-200 hover:text-primary-600 dark:hover:text-primary-400 transition-colors line-clamp-2"
                    >
                      {item.name}
                    </Link>
                    {(item.category_name) && (
                      <p className="text-xs whitespace-nowrap text-gray-600 dark:text-gray-300">
                        {item.category_icon ? `${item.category_icon} ` : ''}{item.category_name}
                      </p>
                    )}
                    {(item.city || item.country) && (
                      <p className="text-xs text-gray-400 truncate">
                        {[item.city, item.country].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {item.rating != null && item.rating >= 1 ? (
                      <Stars value={item.rating} size={12} />
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                    {item.checkin_count}
                  </td>
                  <td className="py-2.5 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {item.last_checkin_at
                      ? formatDate(item.last_checkin_at, item.last_checkin_timezone)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
