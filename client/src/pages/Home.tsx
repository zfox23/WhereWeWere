import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Search, SlidersHorizontal, Plus, Loader2, MapPin, X, Smile, Moon, Route, Clapperboard } from 'lucide-react';
import { timeline as timelineApi, settings, scrobbles as scrobblesApi, immich as immichApi, moodActivities, stats, tracks } from '../api/client';
import { Scrobble, ImmichAsset, TimelineItem } from '../types';
import CheckInCard from '../components/CheckInCard';
import MediaCard from '../components/MediaCard';
import MoodCheckInCard from '../components/MoodCheckInCard';
import SleepCard from '../components/SleepCard';
import TrackCard from '../components/TrackCard';
import Filters from '../components/filters/Filters';
import { MOOD_LABELS } from '../components/MoodIcons';
import { usePageTitle } from '../utils/pageTitle';
import { MEDIA_SUBTYPES } from '../utils/media';
import type { MediaSubtype } from '../types';

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

/**
 * Get the local calendar date of a checkin in its timezone (YYYY-MM-DD).
 * Uses venue_timezone for location checkins and mood_timezone for mood checkins.
 * Falls back to browser local time if no timezone is stored.
 */
function getLocalDateKey(item: TimelineItem): string {
  const dateValue = item.type === 'sleep'
    ? item.sleep_ended_at || item.checked_in_at
    : item.checked_in_at;
  const tz = item.type === 'location'
    ? item.venue_timezone
    : item.type === 'mood'
      ? item.mood_timezone
      : item.type === 'track'
        ? item.track_timezone
        : item.type === 'media'
          ? item.media_timezone
          : item.sleep_timezone;
  return new Date(dateValue).toLocaleDateString('en-CA', {
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
          <Link
            to="/sleep-check-in"
            onClick={() => setExpanded(false)}
            className={`flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm font-medium ${expanded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
            style={{ transitionDelay: expanded ? '0ms' : '100ms' }}
            tabIndex={expanded ? 0 : -1}
          >
            <Moon size={18} className="text-indigo-500" />
            Sleep
            <kbd className="ml-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-600">S</kbd>
          </Link>
          <Link
            to="/track-check-in"
            onClick={() => setExpanded(false)}
            className={`flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm font-medium ${expanded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
            style={{ transitionDelay: expanded ? '40ms' : '80ms' }}
            tabIndex={expanded ? 0 : -1}
          >
            <Route size={18} className="text-rose-500" />
            Track
            <kbd className="ml-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-600">T</kbd>
          </Link>
          <Link
            to="/media-check-in"
            onClick={() => setExpanded(false)}
            className={`flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm font-medium ${expanded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
            style={{ transitionDelay: expanded ? '0ms' : '60ms' }}
            tabIndex={expanded ? 0 : -1}
          >
            <Clapperboard size={18} className="text-violet-500" />
            Media
            <kbd className="ml-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-600">N</kbd>
          </Link>
          <Link
            to="/check-in"
            onClick={() => setExpanded(false)}
            className={`flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm font-medium ${expanded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
            style={{ transitionDelay: expanded ? '40ms' : '40ms' }}
            tabIndex={expanded ? 0 : -1}
          >
            <MapPin size={18} className="text-primary-500" />
            Location
            <kbd className="ml-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-600">L</kbd>
          </Link>
          <Link
            to="/mood-check-in"
            onClick={() => setExpanded(false)}
            className={`flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all text-sm font-medium ${expanded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}
            style={{ transitionDelay: expanded ? '80ms' : '0ms' }}
            tabIndex={expanded ? 0 : -1}
          >
            <Smile size={18} className="text-green-500" />
            Mood
            <kbd className="ml-1 text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1 py-0.5 rounded border border-gray-200 dark:border-gray-600">M</kbd>
          </Link>
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
  const typeParam = searchParams.get('type') || '';
  const timelineType = typeParam === 'location' || typeParam === 'mood' || typeParam === 'sleep' || typeParam === 'track' || typeParam === 'media' ? typeParam : '';
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [includeLocation, setIncludeLocation] = useState(() => timelineType !== 'mood' && timelineType !== 'sleep' && timelineType !== 'track');
  const [includeMood, setIncludeMood] = useState(() => timelineType !== 'location' && timelineType !== 'sleep' && timelineType !== 'track');
  const [includeSleep, setIncludeSleep] = useState(() => timelineType !== 'location' && timelineType !== 'mood' && timelineType !== 'track');
  const [includeTrack, setIncludeTrack] = useState(() => timelineType !== 'location' && timelineType !== 'mood' && timelineType !== 'sleep');
  const [includeMedia, setIncludeMedia] = useState(() => timelineType !== 'location' && timelineType !== 'mood' && timelineType !== 'sleep' && timelineType !== 'track');
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const [trackActivityOptions, setTrackActivityOptions] = useState<string[]>([]);
  const [activityOptions, setActivityOptions] = useState<{ id: string; name: string; groupName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [malojaUrl, setMalojaUrl] = useState<string | null>(null);
  const [dawarichUrl, setDawarichUrl] = useState<string | null>(null);
  const [openTimelineDotDate, setOpenTimelineDotDate] = useState<string | null>(null);
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

  // Load all mood activities for Activity filter dropdown
  useEffect(() => {
    moodActivities.groups().then((groups) => {
      const options = (groups || []).flatMap((g: any) =>
        (g.activities || []).map((a: any) => ({
          id: a.id,
          name: a.name,
          groupName: g.name,
        }))
      );
      options.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
      setActivityOptions(options);
    }).catch(() => {
      setActivityOptions([]);
    });
  }, []);

  // Read filters from URL params
  const searchQuery = searchParams.get('q') || '';
  const fromDate = searchParams.get('from') || '';
  const toDate = searchParams.get('to') || '';
  const venueId = searchParams.get('venue_id') || '';
  const category = searchParams.get('category') || '';
  const country = searchParams.get('country') || '';
  const mood = searchParams.get('mood') || '';
  const activity = searchParams.get('activity') || '';
  const sleepDuration = searchParams.get('sleep_duration') || '';
  const trackActivity = searchParams.get('track_activity') || '';
  const mediaSubtypes = searchParams.get('media_subtype') || '';
  const [showFilters, setShowFilters] = useState(false);
  const hasMoodTypeFilter = Boolean(mood || activity);
  const hasLocationTypeFilter = Boolean(venueId || category || country);
  const hasSleepTypeFilter = Boolean(sleepDuration);
  const hasTrackTypeFilter = Boolean(trackActivity);
  const hasMediaTypeFilter = Boolean(mediaSubtypes);
  const moodFiltersDisabled = hasLocationTypeFilter || hasSleepTypeFilter || hasTrackTypeFilter || hasMediaTypeFilter;
  const locationFiltersDisabled = hasMoodTypeFilter || hasSleepTypeFilter || hasTrackTypeFilter || hasMediaTypeFilter;
  const sleepFiltersDisabled = hasLocationTypeFilter || hasMoodTypeFilter || hasTrackTypeFilter || hasMediaTypeFilter;
  const trackFiltersDisabled = hasLocationTypeFilter || hasMoodTypeFilter || hasSleepTypeFilter || hasMediaTypeFilter;
  const mediaFiltersDisabled = hasLocationTypeFilter || hasMoodTypeFilter || hasSleepTypeFilter || hasTrackTypeFilter;
  const moodTypeToggleDisabled = hasLocationTypeFilter || hasSleepTypeFilter || hasTrackTypeFilter || hasMediaTypeFilter;
  const locationTypeToggleDisabled = hasMoodTypeFilter || hasSleepTypeFilter || hasTrackTypeFilter || hasMediaTypeFilter;
  const sleepTypeToggleDisabled = hasMoodTypeFilter || hasLocationTypeFilter || hasTrackTypeFilter || hasMediaTypeFilter;
  const trackTypeToggleDisabled = hasLocationTypeFilter || hasMoodTypeFilter || hasSleepTypeFilter || hasMediaTypeFilter;
  const mediaTypeToggleDisabled = hasLocationTypeFilter || hasMoodTypeFilter || hasSleepTypeFilter || hasTrackTypeFilter;
  const moodSectionDisabled = moodFiltersDisabled || !includeMood;
  const locationSectionDisabled = locationFiltersDisabled || !includeLocation;
  const sleepSectionDisabled = sleepFiltersDisabled;
  const trackSectionDisabled = trackFiltersDisabled || !includeTrack;
  const mediaSectionDisabled = mediaFiltersDisabled || !includeMedia;

  useEffect(() => {
    if (hasMoodTypeFilter) {
      setIncludeLocation(false);
      setIncludeMood(true);
      setIncludeSleep(false);
      setIncludeTrack(false);
      setIncludeMedia(false);
    }
  }, [hasMoodTypeFilter]);

  useEffect(() => {
    if (hasLocationTypeFilter) {
      setIncludeMood(false);
      setIncludeLocation(true);
      setIncludeSleep(false);
      setIncludeTrack(false);
      setIncludeMedia(false);
    }
  }, [hasLocationTypeFilter]);

  useEffect(() => {
    if (hasSleepTypeFilter) {
      setIncludeLocation(false);
      setIncludeMood(false);
      setIncludeSleep(true);
      setIncludeTrack(false);
      setIncludeMedia(false);
    }
  }, [hasSleepTypeFilter]);

  useEffect(() => {
    if (hasTrackTypeFilter) {
      setIncludeLocation(false);
      setIncludeMood(false);
      setIncludeSleep(false);
      setIncludeTrack(true);
      setIncludeMedia(false);
    }
  }, [hasTrackTypeFilter]);

  useEffect(() => {
    if (hasMediaTypeFilter) {
      setIncludeLocation(false);
      setIncludeMood(false);
      setIncludeSleep(false);
      setIncludeTrack(false);
      setIncludeMedia(true);
    }
  }, [hasMediaTypeFilter]);

  useEffect(() => {
    if (hasMoodTypeFilter || hasLocationTypeFilter || hasSleepTypeFilter || hasTrackTypeFilter || hasMediaTypeFilter) return;
    if (timelineType === 'location') {
      setIncludeLocation(true);
      setIncludeMood(false);
      setIncludeSleep(false);
      setIncludeTrack(false);
      setIncludeMedia(false);
      return;
    }
    if (timelineType === 'mood') {
      setIncludeLocation(false);
      setIncludeMood(true);
      setIncludeSleep(false);
      setIncludeTrack(false);
      setIncludeMedia(false);
      return;
    }
    if (timelineType === 'sleep') {
      setIncludeLocation(false);
      setIncludeMood(false);
      setIncludeSleep(true);
      setIncludeTrack(false);
      setIncludeMedia(false);
      return;
    }
    if (timelineType === 'track') {
      setIncludeLocation(false);
      setIncludeMood(false);
      setIncludeSleep(false);
      setIncludeTrack(true);
      setIncludeMedia(false);
      return;
    }
    if (timelineType === 'media') {
      setIncludeLocation(false);
      setIncludeMood(false);
      setIncludeSleep(false);
      setIncludeTrack(false);
      setIncludeMedia(true);
      return;
    }
    setIncludeLocation(true);
    setIncludeMood(true);
    setIncludeSleep(true);
    setIncludeTrack(true);
    setIncludeMedia(true);
  }, [hasLocationTypeFilter, hasMoodTypeFilter, hasSleepTypeFilter, hasTrackTypeFilter, hasMediaTypeFilter, timelineType]);

  useEffect(() => {
    if (hasMoodTypeFilter || hasLocationTypeFilter || hasSleepTypeFilter || hasTrackTypeFilter || hasMediaTypeFilter) return;
    const allOn = includeLocation && includeMood && includeSleep && includeTrack && includeMedia;
    const nextType = allOn
      ? ''
      : includeLocation && !includeMood && !includeSleep && !includeTrack && !includeMedia
        ? 'location'
        : !includeLocation && includeMood && !includeSleep && !includeTrack && !includeMedia
          ? 'mood'
          : !includeLocation && !includeMood && includeSleep && !includeTrack && !includeMedia
            ? 'sleep'
            : !includeLocation && !includeMood && !includeSleep && includeTrack && !includeMedia
              ? 'track'
              : !includeLocation && !includeMood && !includeSleep && !includeTrack && includeMedia
                ? 'media'
                : '';
    if (nextType === timelineType) return;

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextType) {
        next.set('type', nextType);
      } else {
        next.delete('type');
      }
      return next;
    }, { replace: true });
  }, [hasLocationTypeFilter, hasMoodTypeFilter, hasSleepTypeFilter, hasTrackTypeFilter, hasMediaTypeFilter, includeLocation, includeMood, includeSleep, includeTrack, includeMedia, setSearchParams, timelineType]);

  // Show filters panel if any structured filter is active
  useEffect(() => {
    if (fromDate || toDate || venueId || category || country || mood || activity || sleepDuration || trackActivity || mediaSubtypes) {
      setShowFilters(true);
    }
  }, [fromDate, toDate, venueId, category, country, mood, activity, sleepDuration, trackActivity, mediaSubtypes]);

  // Load distinct track activity types for the Track filter
  useEffect(() => {
    tracks
      .activityTypes()
      .then((types) => setTrackActivityOptions((types || []).sort((a, b) => a.localeCompare(b))))
      .catch(() => setTrackActivityOptions([]));
  }, []);

  useEffect(() => {
    Promise.all([
      stats.categoryBreakdown(USER_ID),
      stats.countries(USER_ID),
    ]).then(([categories, countries]) => {
      const uniqueCategories = Array.from(new Set((categories || [])
        .map((c: any) => String(c.category_name || '').trim())
        .filter(Boolean)))
        .sort((a, b) => a.localeCompare(b));
      const uniqueCountries = Array.from(new Set((countries || [])
        .map((c: any) => String(c.country || '').trim())
        .filter(Boolean)))
        .sort((a, b) => a.localeCompare(b));
      setCategoryOptions(uniqueCategories);
      setCountryOptions(uniqueCountries);
    }).catch(() => {
      setCategoryOptions([]);
      setCountryOptions([]);
    });
  }, []);

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

      const hotkeyRoutes: Record<string, string> = {
        l: '/check-in',
        m: '/mood-check-in',
        s: '/sleep-check-in',
        t: '/track-check-in',
        n: '/media-check-in',
      };
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

  const setMoodTypeFilter = useCallback((key: 'mood' | 'activity', value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('venue_id');
      next.delete('category');
      next.delete('country');
      next.delete('sleep_duration');
      next.delete('track_activity');
      next.delete('media_subtype');
      next.delete('type');
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    }, { replace: true });

    if (value) {
      setIncludeMood(true);
      setIncludeLocation(false);
      setIncludeSleep(false);
      setIncludeTrack(false);
      setIncludeMedia(false);
    }
  }, [setSearchParams]);

  const setLocationTypeFilter = useCallback((key: 'venue_id' | 'category' | 'country', value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('mood');
      next.delete('activity');
      next.delete('sleep_duration');
      next.delete('track_activity');
      next.delete('media_subtype');
      next.delete('type');
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    }, { replace: true });

    if (value) {
      setIncludeLocation(true);
      setIncludeMood(false);
      setIncludeSleep(false);
      setIncludeTrack(false);
      setIncludeMedia(false);
    }
  }, [setSearchParams]);

  const setSleepTypeFilter = useCallback((value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('venue_id');
      next.delete('category');
      next.delete('country');
      next.delete('mood');
      next.delete('activity');
      next.delete('track_activity');
      next.delete('media_subtype');
      next.delete('type');
      if (value) {
        next.set('sleep_duration', value);
      } else {
        next.delete('sleep_duration');
      }
      return next;
    }, { replace: true });

    if (!value) {
      setIncludeLocation(true);
      setIncludeMood(true);
      setIncludeSleep(true);
      setIncludeTrack(true);
      setIncludeMedia(true);
    }
  }, [setSearchParams]);

  const setTrackTypeFilter = useCallback((value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('venue_id');
      next.delete('category');
      next.delete('country');
      next.delete('mood');
      next.delete('activity');
      next.delete('sleep_duration');
      next.delete('media_subtype');
      next.delete('type');
      if (value) {
        next.set('track_activity', value);
      } else {
        next.delete('track_activity');
      }
      return next;
    }, { replace: true });

    if (value) {
      setIncludeTrack(true);
      setIncludeLocation(false);
      setIncludeMood(false);
      setIncludeSleep(false);
      setIncludeMedia(false);
    }
  }, [setSearchParams]);

  const setMediaSubtypeFilter = useCallback((value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('venue_id');
      next.delete('category');
      next.delete('country');
      next.delete('mood');
      next.delete('activity');
      next.delete('sleep_duration');
      next.delete('track_activity');
      next.delete('type');
      if (value) {
        next.set('media_subtype', value);
      } else {
        next.delete('media_subtype');
      }
      return next;
    }, { replace: true });

    if (value) {
      setIncludeMedia(true);
      setIncludeLocation(false);
      setIncludeMood(false);
      setIncludeSleep(false);
      setIncludeTrack(false);
    }
  }, [setSearchParams]);

  const toggleLocationType = useCallback(() => {
    if (locationTypeToggleDisabled) return;
    setIncludeLocation((prev) => {
      if (prev && !includeMood && !includeSleep && !includeTrack && !includeMedia) return prev;
      return !prev;
    });
  }, [includeMood, includeSleep, includeTrack, includeMedia, locationTypeToggleDisabled]);

  const toggleMoodType = useCallback(() => {
    if (moodTypeToggleDisabled) return;
    setIncludeMood((prev) => {
      if (prev && !includeLocation && !includeSleep && !includeTrack && !includeMedia) return prev;
      return !prev;
    });
  }, [includeLocation, includeSleep, includeTrack, includeMedia, moodTypeToggleDisabled]);

  const toggleSleepType = useCallback(() => {
    if (sleepTypeToggleDisabled) return;
    setIncludeSleep((prev) => {
      if (prev && !includeLocation && !includeMood && !includeTrack && !includeMedia) return prev;
      return !prev;
    });
  }, [includeLocation, includeMood, includeTrack, includeMedia, sleepTypeToggleDisabled]);

  const toggleTrackType = useCallback(() => {
    if (trackTypeToggleDisabled) return;
    setIncludeTrack((prev) => {
      if (prev && !includeLocation && !includeMood && !includeSleep && !includeMedia) return prev;
      return !prev;
    });
  }, [includeLocation, includeMood, includeSleep, includeMedia, trackTypeToggleDisabled]);

  const toggleMediaType = useCallback(() => {
    if (mediaTypeToggleDisabled) return;
    setIncludeMedia((prev) => {
      if (prev && !includeLocation && !includeMood && !includeSleep && !includeTrack) return prev;
      return !prev;
    });
  }, [includeLocation, includeMood, includeSleep, includeTrack, mediaTypeToggleDisabled]);

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
          if (mood) params.mood = mood;
          if (activity) params.activity = activity;
          if (sleepDuration) params.sleep_duration = sleepDuration;
          if (trackActivity) params.track_activity = trackActivity;
          if (mediaSubtypes) params.media_subtype = mediaSubtypes;

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
      [searchQuery, fromDate, toDate, venueId, category, country, mood, activity, sleepDuration, trackActivity, mediaSubtypes]
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
  }, [items, includeLocation, includeMood, includeSleep, loading, loadingMore]);

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
    setIncludeLocation(true);
    setIncludeMood(true);
    setIncludeSleep(true);
    setIncludeTrack(true);
    setIncludeMedia(true);
    setShowFilters(false);
  };

  const hasTypeSelectionFilter = !includeLocation || !includeMood || !includeSleep || !includeTrack || !includeMedia;
  const hasActiveFilters = searchQuery || fromDate || toDate || venueId || category || country || mood || activity || sleepDuration || hasTypeSelectionFilter;
  const visibleItems = useMemo(
    () => items.filter((item) => {
      if (item.type === 'location') return includeLocation;
      if (item.type === 'mood') return includeMood;
      if (item.type === 'sleep') return includeSleep;
      if (item.type === 'track') return includeTrack;
      if (item.type === 'media') return includeMedia;
      return false;
    }),
    [items, includeLocation, includeMood, includeSleep, includeTrack, includeMedia]
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
  if (mood) {
    const moodNum = parseInt(mood, 10);
    filterPills.push({ label: `Mood: ${moodNum >= 1 && moodNum <= 5 ? MOOD_LABELS[moodNum] : mood}`, key: 'mood' });
  }
  if (activity) filterPills.push({ label: `Activity: ${activity}`, key: 'activity' });
  if (trackActivity) filterPills.push({ label: `Track activity: ${trackActivity}`, key: 'track_activity' });
  if (sleepDuration === 'lte6') filterPills.push({ label: 'Sleep: <=6h', key: 'sleep_duration' });
  if (sleepDuration === '6to8') filterPills.push({ label: 'Sleep: 6h-8h', key: 'sleep_duration' });
  if (sleepDuration === 'gte8') filterPills.push({ label: 'Sleep: >=8h', key: 'sleep_duration' });
  if (includeLocation && !includeMood && !includeSleep && !includeTrack) filterPills.push({ label: 'Type: Location only', key: 'type_location_only' });
  if (!includeLocation && includeMood && !includeSleep && !includeTrack) filterPills.push({ label: 'Type: Mood only', key: 'type_mood_only' });
  if (!includeLocation && !includeMood && includeSleep && !includeTrack) filterPills.push({ label: 'Type: Sleep only', key: 'type_sleep_only' });
  if (!includeLocation && !includeMood && !includeSleep && includeTrack) filterPills.push({ label: 'Type: Track only', key: 'type_track_only' });
  if (!includeLocation && !includeMood && !includeSleep && !includeTrack && includeMedia) filterPills.push({ label: 'Type: Media only', key: 'type_media_only' });
  if (mediaSubtypes) {
    filterPills.push({
      label: `Media: ${mediaSubtypes.split(',').map((s) => MEDIA_SUBTYPES[s.trim() as MediaSubtype]?.label || s.trim()).join(', ')}`,
      key: 'media_subtype',
    });
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
                  } else if (pill.key === 'type_location_only') {
                    setIncludeMood(true);
                    setIncludeSleep(true);
                    setIncludeTrack(true);
                    setIncludeMedia(true);
                  } else if (pill.key === 'type_mood_only') {
                    setIncludeLocation(true);
                    setIncludeSleep(true);
                    setIncludeTrack(true);
                    setIncludeMedia(true);
                  } else if (pill.key === 'type_sleep_only') {
                    setIncludeLocation(true);
                    setIncludeMood(true);
                    setIncludeTrack(true);
                    setIncludeMedia(true);
                  } else if (pill.key === 'type_track_only') {
                    setIncludeLocation(true);
                    setIncludeMood(true);
                    setIncludeSleep(true);
                    setIncludeMedia(true);
                  } else if (pill.key === 'type_media_only') {
                   setIncludeLocation(true);
                   setIncludeMood(true);
                   setIncludeSleep(true);
                   setIncludeTrack(true);
                 } else if (pill.key === 'media_subtype') {
                   setMediaSubtypeFilter('');
                 } else if (pill.key === 'sleep_duration') {
                    setSleepTypeFilter('');
                  } else if (pill.key === 'track_activity') {
                    setTrackTypeFilter('');
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
            category={category}
            country={country}
            mood={mood}
            activity={activity}
            sleepDuration={sleepDuration}
            trackActivity={trackActivity}
            mediaSubtypes={mediaSubtypes}
            includeLocation={includeLocation}
            includeMood={includeMood}
            includeSleep={includeSleep}
            includeTrack={includeTrack}
            includeMedia={includeMedia}
            categoryOptions={categoryOptions}
            countryOptions={countryOptions}
            activityOptions={activityOptions}
            trackActivityOptions={trackActivityOptions}
            moodTypeToggleDisabled={moodTypeToggleDisabled}
            locationTypeToggleDisabled={locationTypeToggleDisabled}
            sleepTypeToggleDisabled={sleepTypeToggleDisabled}
            trackTypeToggleDisabled={trackTypeToggleDisabled}
            mediaTypeToggleDisabled={mediaTypeToggleDisabled}
            moodFiltersDisabled={moodFiltersDisabled}
            locationFiltersDisabled={locationFiltersDisabled}
            sleepFiltersDisabled={sleepFiltersDisabled}
            trackFiltersDisabled={trackFiltersDisabled}
            mediaFiltersDisabled={mediaFiltersDisabled}
            moodSectionDisabled={moodSectionDisabled}
            locationSectionDisabled={locationSectionDisabled}
            sleepSectionDisabled={sleepSectionDisabled}
            trackSectionDisabled={trackSectionDisabled}
            mediaSectionDisabled={mediaSectionDisabled}
            onSetDateFilter={setFilter}
            onToggleLocationType={toggleLocationType}
            onToggleMoodType={toggleMoodType}
            onToggleSleepType={toggleSleepType}
            onToggleTrackType={toggleTrackType}
            onToggleMediaType={toggleMediaType}
            onSetMoodFilter={setMoodTypeFilter}
            onSetLocationFilter={setLocationTypeFilter}
            onSetSleepFilter={setSleepTypeFilter}
            onSetTrackFilter={setTrackTypeFilter}
            onSetMediaFilter={setMediaSubtypeFilter}
            onClearAll={clearFilters}
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
          {!hasActiveFilters && (
            <Link to="/check-in" className="btn-primary">
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
                    <Link
                      to={`/check-in?date=${encodeURIComponent(date)}`}
                      className="p-1.5 ml-2 rounded-full text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/30 transition-colors"
                      title="Location check-in"
                      onClick={() => setOpenTimelineDotDate(null)}
                      tabIndex={openTimelineDotDate === date ? 0 : -1}
                    >
                      <MapPin size={24} />
                    </Link>
                    <Link
                      to={`/mood-check-in?date=${encodeURIComponent(date)}`}
                      className="p-1.5 rounded-full text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30 transition-colors"
                      title="Mood check-in"
                      onClick={() => setOpenTimelineDotDate(null)}
                      tabIndex={openTimelineDotDate === date ? 0 : -1}
                    >
                      <Smile size={24} />
                    </Link>
                    <Link
                      to={`/sleep-check-in?date=${encodeURIComponent(date)}`}
                      className="p-1.5 rounded-full text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/30 transition-colors"
                      title="Sleep check-in"
                      onClick={() => setOpenTimelineDotDate(null)}
                      tabIndex={openTimelineDotDate === date ? 0 : -1}
                    >
                      <Moon size={24} />
                    </Link>
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
                <div className="ml-[5px] border-l-2 border-gray-200 dark:border-gray-700 pl-3 pb-4 space-y-3">
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
                        {item.type === 'mood' ? (
                          <MoodCheckInCard
                            item={item}
                            iconPack={iconPack}
                            immichUrl={immichUrl}
                            photos={photosMap[item.id] ?? null}
                            scrobbles={dedupedScrobblesMap[item.id]}
                            malojaUrl={malojaUrl}
                          />
                        ) : item.type === 'sleep' ? (
                          <SleepCard
                            item={item}
                          />
                        ) : item.type === 'track' ? (
                          <TrackCard
                            item={item}
                            immichUrl={immichUrl}
                            photos={photosMap[item.id] ?? null}
                            scrobbles={dedupedScrobblesMap[item.id]}
                            malojaUrl={malojaUrl}
                          />
                        ) : item.type === 'media' ? (
                          <MediaCard item={item} />
                        ) : (
                          <CheckInCard
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
                              checked_in_at: item.checked_in_at,
                              created_at: item.created_at,
                            }}
                            immichUrl={immichUrl}
                            photos={photosMap[item.id] ?? null}
                            scrobbles={dedupedScrobblesMap[item.id]}
                            malojaUrl={malojaUrl}
                            dawarichUrl={dawarichUrl}
                          />
                        )}
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
