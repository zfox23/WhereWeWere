import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Search, SlidersHorizontal, Plus, Loader2, MapPin, X, AlignJustify, Rows3 } from 'lucide-react';
import { timeline as timelineApi, settings, scrobbles as scrobblesApi, immich as immichApi } from '../api/client';
import { Scrobble, ImmichAsset, TimelineItem } from '../types';
import type { PluginTimelineEntry } from 'wwp-shared';
import { allClientPlugins, getClientPlugin, hasClientPlugin } from '../plugins/registry';
import { PluginTimelineCard } from '../plugins/autoCard';
import { plugins as pluginApi } from '../plugins/api';
import Filters from '../components/filters/Filters';
import { usePageTitle } from '../utils/pageTitle';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const PAGE_SIZE = 20;

/** Check-in plugins that should appear in the expandable FAB, by fabOrder. */
const FAB_PLUGINS = allClientPlugins().slice().sort((a, b) => (a.client.fabOrder ?? 100) - (b.client.fabOrder ?? 100));
/** Hotkey -> plugin check-in route (plugins with a declared hotkey). */
const PLUGIN_HOTKEYS: Record<string, string> = Object.fromEntries(
  allClientPlugins()
    .filter((p) => p.client.hotkey)
    .map((p) => [p.client.hotkey as string, p.client.checkInPath]),
);

/** All registered check-in plugins get the generic filter section + include state. */
const NEW_PLUGINS = allClientPlugins();

function formatDateHeader(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(dateStr + 'T12:00:00'));
}

/**
 * Get the local calendar date of a checkin in its timezone (YYYY-MM-DD).
 * Every branch of the unified timeline emits the shared `timezone` column;
 * falls back to browser local time when it is null.
 */
function getLocalDateKey(item: TimelineItem): string {
  const tz = item.timezone ?? null;
  return new Date(item.checked_in_at).toLocaleDateString('en-CA', {
    ...(tz ? { timeZone: tz } : {}),
  });
}

function groupByDate(items: TimelineItem[]): Map<string, TimelineItem[]> {
  const groups = new Map<string, TimelineItem[]>();
  for (const item of items) {
    const date = getLocalDateKey(item);
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

  const toLocalDateKey = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  for (let d = new Date(end); d >= start; d.setDate(d.getDate() - 1)) {
    const key = toLocalDateKey(d);
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
      <div
        className={`fixed inset-0 z-30 m-0 bg-black/20 backdrop-blur-sm transition-opacity duration-200 ${expanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setExpanded(false)}
      />

      <div className={`fixed bottom-36 md:bottom-24 right-4 md:right-6 z-40 flex flex-col gap-3 items-end transition-all duration-200 ease-out ${expanded ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'}`} aria-hidden={!expanded}>
          {FAB_PLUGINS.map((plugin) => {
            const Icon = plugin.client.icon as React.ElementType<{ size?: number; className?: string }>;
            return (
              <Link
                key={plugin.id}
                to={plugin.client.checkInPath}
                onClick={() => setExpanded(false)}
                className={`flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm font-medium ${expanded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
                style={{ transitionDelay: expanded ? '80ms' : '0ms' }}
                tabIndex={expanded ? 0 : -1}
              >
                <Icon size={18} className={plugin.client.iconColor} />
                {plugin.strings.title}
                {plugin.client.hotkey && (
                  <kbd className="ml-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-600">{plugin.client.hotkey.toUpperCase()}</kbd>
                )}
              </Link>
            );
          })}
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 w-14 h-14 bg-linear-to-br from-primary-500 to-primary-700 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-primary-500/30 hover:shadow-lg hover:shadow-primary-500/50 hover:scale-105 transition-all"
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
  usePageTitle('Home');

  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const newId = (location.state as { newId?: string } | null)?.newId ?? null;
  const newIdAnimatedRef = useRef<string | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  // Inclusion state for each check-in plugin type.
  const [pluginIncludes, setPluginIncludes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(NEW_PLUGINS.map((p) => [p.id, true])),
  );
  const setAllPluginIncludes = useCallback((value: boolean) => {
    setPluginIncludes(Object.fromEntries(NEW_PLUGINS.map((p) => [p.id, value])));
  }, []);
  const setOnlyPluginInclude = useCallback((pluginId: string, value: boolean) => {
    setPluginIncludes(Object.fromEntries(
      NEW_PLUGINS.map((p) => [p.id, value && p.id === pluginId]),
    ));
  }, []);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [malojaUrl, setMalojaUrl] = useState<string | null>(null);
  const [dawarichUrl, setDawarichUrl] = useState<string | null>(null);
  const [openTimelineDotDate, setOpenTimelineDotDate] = useState<string | null>(null);
  const [pluginSettings, setPluginSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [timelineDensity, setTimelineDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [scrobblesMap, setScrobblesMap] = useState<Record<string, Scrobble[]>>({});
  const [photosMap, setPhotosMap] = useState<Record<string, ImmichAsset[]>>({});

  // Fetch integration URLs from settings
  useEffect(() => {
    settings.get().then((s) => {
      if (s.immich_url) setImmichUrl(s.immich_url.replace(/\/+$/, ''));
      if (s.maloja_url) setMalojaUrl(s.maloja_url.replace(/\/+$/, ''));
      if (s.dawarich_url) setDawarichUrl(s.dawarich_url.replace(/\/+$/, ''));
      if (s.timeline_density === 'compact' || s.timeline_density === 'comfortable') setTimelineDensity(s.timeline_density);
    }).catch(() => {});
  }, []);

  // Load each plugin's settings (e.g. the mood icon pack) for its cards.
  useEffect(() => {
    Promise.all(
      allClientPlugins().map(async (plugin) => {
        try {
          return [plugin.id, await pluginApi.settings.get(plugin.id)] as const;
        } catch {
          return [plugin.id, {}] as const;
        }
      }),
    ).then((entries) => setPluginSettings(Object.fromEntries(entries)));
  }, []);

  const toggleTimelineDensity = useCallback(() => {
    setTimelineDensity((prev) => {
      const next = prev === 'compact' ? 'comfortable' : 'compact';
      settings.update({ timeline_density: next }).catch(() => {});
      return next;
    });
  }, []);


  // Read filters from URL params
  const searchQuery = searchParams.get('q') || '';
  const fromDate = searchParams.get('from') || '';
  const toDate = searchParams.get('to') || '';
  const venueId = searchParams.get('venue_id') || '';
  const category = searchParams.get('category') || '';
  const country = searchParams.get('country') || '';
  const [showFilters, setShowFilters] = useState(false);

  // Check-in plugin filter params, scoped per plugin.
  const pluginFilterParams = useMemo(() => {
    const out: Record<string, Record<string, string>> = {};
    for (const plugin of NEW_PLUGINS) {
      const params: Record<string, string> = {};
      for (const name of plugin.filterParams ?? []) {
        const v = searchParams.get(name);
        if (v) params[name] = v;
      }
      out[plugin.id] = params;
    }
    return out;
  }, [searchParams]);
  const pluginFilterKeys = NEW_PLUGINS.flatMap((p) => p.filterParams ?? []);
  const activePluginFilterId = useMemo(() => {
    for (const plugin of NEW_PLUGINS) {
      if (Object.keys(pluginFilterParams[plugin.id] ?? {}).length > 0) return plugin.id;
    }
    return null;
  }, [pluginFilterParams]);
  const hasPluginFilter = activePluginFilterId !== null;

  // Plugin filter disabled states (mutually exclusive with every other type).
  const pluginFiltersDisabled = hasPluginFilter;
  const pluginTypeToggleDisabled = hasPluginFilter;

  // Whether any plugin check-in type is currently included in the timeline.
  const anyPluginOn = Object.entries(pluginIncludes).some(([, v]) => v ?? true);

  const pluginFilterSpecs = NEW_PLUGINS.map((plugin) => ({
    plugin,
    included: pluginIncludes[plugin.id] ?? true,
    filtersDisabled: pluginFiltersDisabled || !(pluginIncludes[plugin.id] ?? true),
    sectionDisabled: pluginFiltersDisabled || !(pluginIncludes[plugin.id] ?? true),
    typeToggleDisabled: pluginTypeToggleDisabled,
    params: pluginFilterParams[plugin.id] ?? {},
    onToggleIncluded: () => togglePluginType(plugin.id),
    onSetParam: (name: string, value: string) => setPluginTypeFilter(plugin.id, name, value),
  }));

  function includedForType(type: string): boolean {
    if (NEW_PLUGINS.some((p) => p.id === type)) return pluginIncludes[type] ?? true;
    return true;
  }

  function togglePluginType(pluginId: string) {
    if (pluginTypeToggleDisabled) return;
    setPluginIncludes((prev) => {
      const current = prev[pluginId] ?? true;
      // Keep at least one type visible.
      const othersOn = Object.keys(prev).some((k) => k !== pluginId && (prev[k] ?? true));
      if (current && !othersOn) {
        return prev;
      }
      return { ...prev, [pluginId]: !current };
    });
  }

  function setPluginTypeFilter(pluginId: string, name: string, value: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      // Clear every other type's filter params (mutual exclusivity).
      for (const key of pluginFilterKeys) next.delete(key);
      next.delete('venue_id');
      next.delete('category');
      next.delete('country');
      next.delete('track_activity');
      next.delete('type');
      if (value) next.set(name, value);
      return next;
    }, { replace: true });

    if (value) {
      setAllPluginIncludes(false);
      setOnlyPluginInclude(pluginId, true);
    }
  }

  // A plugin filter narrows to that one plugin type.
  useEffect(() => {
    if (activePluginFilterId) {
      if (hasClientPlugin(activePluginFilterId)) {
        setOnlyPluginInclude(activePluginFilterId, true);
      }
    }
  }, [activePluginFilterId, setOnlyPluginInclude]);

  // Restores include state. Plugin filter branches intentionally do NOT
  // touch `pluginIncludes`: plugin sections are independent of the legacy
  // `type` selection, and unconditionally resetting them here clobbered
  // plugin toggles whenever the URL-sync effect below wrote `type` after a
  // normal include toggle.
  useEffect(() => {
    if (hasPluginFilter) return;
    setAllPluginIncludes(true);
  }, [hasPluginFilter, setAllPluginIncludes]);

  // Show filters panel if any structured filter is active
  useEffect(() => {
    if (fromDate || toDate || venueId || category || country || hasPluginFilter) {
      setShowFilters(true);
    }
  }, [fromDate, toDate, venueId, category, country, hasPluginFilter]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const feedContainerRef = useRef<HTMLDivElement>(null);
  const revealObserverRef = useRef<IntersectionObserver | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (isEditable || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;

      // Plugin-declared hotkeys (plugins may override built-in keys).
      const hotkeyRoutes: Record<string, string> = { ...PLUGIN_HOTKEYS };
      const route = hotkeyRoutes[e.key.toLowerCase()];
      if (route) {
        e.preventDefault();
        navigate(route);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

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
        if (toDate) params.to = toDate;
        if (venueId) params.venue_id = venueId;
        if (category) params.category = category;
        if (country) params.country = country;
        // Plugin filter params (including the media plugin's media_subtype).
          for (const [pluginId, pluginParams] of Object.entries(pluginFilterParams)) {
            for (const [name, value] of Object.entries(pluginParams)) {
              params[name] = value;
            }
          }

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
      [searchQuery, fromDate, toDate, venueId, category, country, pluginFilterParams]
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

  // All visible timeline items for cross-type photo/scrobble deduplication
  const timelineItems = useMemo(() => items, [items]);

  // Fetch scrobbles for loaded timeline check-ins
  useEffect(() => {
    if (!malojaUrl || timelineItems.length === 0) return;
    const newIds = timelineItems.map((c) => c.id).filter((id) => !(id in scrobblesMap));
    if (newIds.length === 0) return;
    scrobblesApi.forCheckins(newIds).then((data) => {
      setScrobblesMap((prev) => ({ ...prev, ...data }));
    }).catch(() => {});
  }, [timelineItems, malojaUrl, scrobblesMap]);

  // Deduplicate scrobbles across checkins: assign each scrobble to the closest checkin
  const dedupedScrobblesMap = useMemo(() => {
    if (timelineItems.length <= 1) return scrobblesMap;
    const assignments: Map<number, { checkinId: string; checkinTimeMs: number; scrobble: Scrobble }[]> = new Map();
    for (const item of timelineItems) {
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
  }, [scrobblesMap, timelineItems]);

  // Fetch photos for loaded timeline check-ins (batch with deduplication)
  useEffect(() => {
    if (!immichUrl || timelineItems.length === 0) return;
    const newIds = timelineItems.map((c) => c.id).filter((id) => !(id in photosMap));
    if (newIds.length === 0) return;
    immichApi.photosForCheckins(newIds).then((data) => {
      setPhotosMap((prev) => ({ ...prev, ...data }));
    }).catch(() => {});
  }, [timelineItems, immichUrl, photosMap]);

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

  useEffect(() => {
    const feed = feedContainerRef.current;
    if (!feed) return;

    const cards = Array.from(feed.querySelectorAll<HTMLElement>('[data-home-reveal]'));
    if (cards.length === 0) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      cards.forEach((card) => card.classList.add('is-visible'));
      return;
    }

    revealObserverRef.current?.disconnect();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );

    cards.forEach((card) => {
      if (card.classList.contains('is-visible')) return;
      observer.observe(card);
    });

    revealObserverRef.current = observer;
    return () => observer.disconnect();
    // pluginIncludes must retrigger this effect: when a type is
    // re-included, React mounts fresh `motion-safe-reveal` divs that would
    // otherwise never receive `.is-visible` and stay at opacity 0.
  }, [items, pluginIncludes, loading, loadingMore]);

  // Scroll to and animate newly created entry
  useEffect(() => {
    if (!newId || newId === newIdAnimatedRef.current || loading) return;
    const el = feedContainerRef.current?.querySelector<HTMLElement>(`[data-new-entry="${newId}"]`);
    if (!el) return;
    newIdAnimatedRef.current = newId;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.history.replaceState(null, '', '/');
  }, [newId, loading, items]);

  const clearFilters = () => {
    setSearchParams({}, { replace: true });
    setAllPluginIncludes(true);
    setShowFilters(false);
  };

  const hasNewPluginFilter = Object.keys(pluginIncludes).some((k) => !(pluginIncludes[k] ?? true));
  const hasTypeSelectionFilter = hasNewPluginFilter;
  const hasActiveFilters = searchQuery || fromDate || toDate || venueId || category || country || hasPluginFilter || hasTypeSelectionFilter;
  const visibleItems = useMemo(
    () => items.filter((item) => {
      if (NEW_PLUGINS.some((p) => p.id === item.type)) return pluginIncludes[item.type] ?? true;
      return false;
    }),
    [items, pluginIncludes]
  );
  const rawGrouped = groupByDate(visibleItems);
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
  // One pill per active plugin filter param (e.g. the media plugin's
  // media_subtype). Generic over all check-in plugins that declare filterParams.
  for (const plugin of NEW_PLUGINS) {
    for (const [name, value] of Object.entries(pluginFilterParams[plugin.id] ?? {})) {
      filterPills.push({ label: `${plugin.strings.title}: ${value}`, key: name });
    }
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <button
            type="button"
            onClick={() => searchInputRef.current?.focus()}
            className="absolute left-3 top-1/2 z-10 -translate-y-1/2 text-primary-400 transition-colors hover:text-primary-500"
            aria-label="Focus search"
          >
            <Search size={18} />
          </button>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setFilter('q', e.target.value)}
            placeholder="Search check-ins..."
            className="w-full pl-10 pr-4 py-3 bg-white/70 dark:bg-gray-900/70 border border-white/40 dark:border-gray-700/40 rounded-2xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none shadow-sm shadow-black/3 dark:text-gray-100"
          />
        </div>
        <button
          onClick={toggleTimelineDensity}
          className={`px-3 py-3 rounded-2xl border transition-all ${
            timelineDensity === 'compact'
              ? 'bg-primary-50/70 border-primary-300/60 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'bg-white/70 dark:bg-gray-900/70 border-white/40 dark:border-gray-700/40 text-gray-600 dark:text-gray-400 hover:bg-white/90 dark:hover:bg-gray-800/90 shadow-sm shadow-black/3'
          }`}
          title={timelineDensity === 'compact' ? 'Comfortable density' : 'Compact density'}
          aria-label={timelineDensity === 'compact' ? 'Switch to comfortable density' : 'Switch to compact density'}
        >
          {timelineDensity === 'compact' ? <AlignJustify size={18} /> : <Rows3 size={18} />}
        </button>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-3 rounded-2xl border transition-all ${
            showFilters || hasActiveFilters
              ? 'bg-primary-50/70 border-primary-300/60 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'bg-white/70 dark:bg-gray-900/70 border-white/40 dark:border-gray-700/40 text-gray-600 dark:text-gray-400 hover:bg-white/90 dark:hover:bg-gray-800/90 shadow-sm shadow-black/3'
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
      <div className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-out ${showFilters ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}>
        <div className="min-h-0">
          <Filters
            hasActiveFilters={Boolean(hasActiveFilters)}
            fromDate={fromDate}
            toDate={toDate}
            onSetDateFilter={setFilter}
            onClearAll={clearFilters}
            pluginFilterSpecs={pluginFilterSpecs}
          />
        </div>
      </div>

      {openTimelineDotDate && (
        <button
          type="button"
          aria-label="Close timeline quick actions"
          onClick={() => setOpenTimelineDotDate(null)}
          className="fixed inset-0 z-20 cursor-default"
        />
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
      ) : visibleItems.length === 0 ? (
        <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-8 text-center">
          <MapPin size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-4">
            {hasActiveFilters ? 'No check-ins match your filters.' : 'No check-ins yet. Start exploring!'}
          </p>
          {!hasActiveFilters && FAB_PLUGINS[0] && (
            <Link to={FAB_PLUGINS[0].client.checkInPath} className="btn-primary">
              <MapPin size={18} className="mr-2" />
              First Check In
            </Link>
          )}
        </div>
      ) : (
        <div ref={feedContainerRef} className="space-y-0">
          {Array.from(grouped.entries()).map(([date, dateItems]) => (
            <div key={date} className="relative">
              {/* Date header with timeline dot */}
              <div className="flex items-center gap-3 py-2">
                <div className="relative z-30">
                  <button
                    type="button"
                    onClick={() => setOpenTimelineDotDate((prev) => prev === date ? null : date)}
                    className="group -m-1.5 p-1.5 shrink-0 relative z-10 flex items-center justify-center"
                    aria-label={`Open quick check-in actions for ${formatDateHeader(date)}`}
                    aria-expanded={openTimelineDotDate === date}
                  >
                    <span className={`w-3 h-3 rounded-full bg-primary-500 ring-4 dark:ring-primary-900/30 flex items-center justify-center transition-transform group-hover:scale-110 ${openTimelineDotDate === date ? 'ring-primary-200 dark:ring-primary-800/70' : 'ring-primary-100'}`}>
                      <Plus size={8} className={`text-white transition-opacity ${openTimelineDotDate === date ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                    </span>
                  </button>
                  <div
                    className={`absolute left-[-9px] top-1/2 -translate-y-1/2 z-30 flex items-center gap-3 rounded-full border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 px-2 py-1 shadow-lg backdrop-blur-sm transition-all duration-200 ease-out ${openTimelineDotDate === date ? 'opacity-100 translate-x-0 scale-100 pointer-events-auto' : 'opacity-0 -translate-x-1 scale-95 pointer-events-none'}`}
                    aria-hidden={openTimelineDotDate !== date}
                  >
                    <button className={`w-3 h-3 rounded-full bg-primary-500 ring-4 rotate-45 dark:ring-primary-900/30 flex items-center justify-center transition-transform group-hover:scale-110 ${openTimelineDotDate === date ? 'ring-primary-200 dark:ring-primary-800/70' : 'ring-primary-100'}`}
                      onClick={() => setOpenTimelineDotDate(null)}>
                      <Plus size={8} className={`text-white transition-opacity ${openTimelineDotDate === date ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                    </button>
                    {FAB_PLUGINS.map((plugin) => {
                      const Icon = plugin.client.icon as React.ElementType<{ size?: number; className?: string }>;
                      return (
                        <Link
                          key={plugin.id}
                          to={`${plugin.client.checkInPath}?date=${encodeURIComponent(date)}`}
                          className={`p-1.5 rounded-full transition-colors hover:bg-gray-100 dark:hover:bg-gray-800`}
                          title={`${plugin.strings.title} check-in`}
                          onClick={() => setOpenTimelineDotDate(null)}
                          tabIndex={openTimelineDotDate === date ? 0 : -1}
                        >
                          <Icon size={24} className={plugin.client.iconColor} />
                        </Link>
                      );
                    })}
                  </div>
                </div>
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
                <div className={`ml-[5px] border-l-2 border-gray-200 dark:border-gray-700 pl-3 pb-4 ${timelineDensity === 'compact' ? 'space-y-1.5' : 'space-y-3'}`}>
                  {dateItems.map((item, index) => {
                    const revealStyle: CSSProperties = {
                      transitionDelay: `${Math.min(index, 8) * 36}ms`,
                    };

                    const isNew = item.id === newId;
                    return (
                      <div
                        key={item.id}
                        {...(isNew ? { 'data-new-entry': item.id } : { 'data-home-reveal': '' })}
                        className={isNew ? 'new-entry-highlight' : 'motion-safe-reveal'}
                        style={isNew ? undefined : revealStyle}
                      >
                        {hasClientPlugin(item.type) ? (
                          <PluginTimelineCard
                            item={item as unknown as PluginTimelineEntry}
                            plugin={getClientPlugin(item.type)!}
                            integrations={{ immich_url: immichUrl, maloja_url: malojaUrl, dawarich_url: dawarichUrl }}
                            compact={timelineDensity === 'compact'}
                            photos={photosMap[item.id] ?? null}
                            scrobbles={dedupedScrobblesMap[item.id]}
                            settings={pluginSettings[item.type]}
                          />
                        ) : null}
                      </div>
                    );
                  })}
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
