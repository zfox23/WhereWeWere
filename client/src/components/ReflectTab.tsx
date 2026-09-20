import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, History, Loader2, Compass } from 'lucide-react';
import { immich as immichApi, settings, stats, scrobbles } from '../api/client';
import { MoodYearInPixels } from '../../../plugins/mood/ui/MoodStats';
import { moodStats } from '../../../plugins/mood/ui/api';
import { SleepYearInPixels } from '../../../plugins/sleep/ui/SleepStats';
import { sleepStats } from '../../../plugins/sleep/ui/api';
import type { SleepDailyPoint } from '../../../plugins/sleep/ui/types';
import { plugins } from '../plugins/api';
import { getClientPlugin, pluginDetailPath } from '../plugins/registry';
import { PhotoStrip } from './PhotoStrip';
import { LifeSummarySection } from './LifeSummarySection';
import { MalojaScrobbleStrip } from './MalojaScrobbleStrip';
import { Heatmap } from './Stats';
import { normalizeTimezoneForDisplay } from '../utils/checkin';
import type { HeatmapDay, ImmichAsset } from '../types';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const IMMICH_CHECKIN_BATCH_SIZE = 30;

type ReflectionItem = {
  type: 'location' | (string & {});
  id: string;
  checked_in_at: string;
  note?: string | null;
  venue_id?: string | null;
  venue_name?: string | null;
  venue_category?: string | null;
  city?: string | null;
  country?: string | null;
  venue_timezone?: string | null;
  mood?: number | null;
  mood_timezone?: string | null;
  activities?: { id: string; name: string; group_name: string; icon?: string | null }[];
  /** Plugin-typed payload for plugin reflection entries. */
  data?: Record<string, unknown> | null;
};

type ReflectionYear = {
  year: number;
  years_ago: number;
  items: ReflectionItem[];
};

type MoodHeatmapPoint = {
  date: string;
  avg_mood: number;
};

/**
 * Minimal chip for plugin reflection entries whose plugin does not ship a
 * custom `reflectionCard`.
 */
function PluginReflectionFallback({ item }: { item: ReflectionItem }) {
  const plugin = getClientPlugin(item.type);
  const label = plugin?.strings.singular ?? item.type;
  const data = (item.data ?? {}) as Record<string, unknown>;
  const timeZone = typeof data.timezone === 'string' ? data.timezone : null;

  return (
    <div className="text-xs space-y-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={pluginDetailPath(item.type, item.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          {label}
        </Link>
      </div>
      {item.note ? (
        <p className="text-gray-600 dark:text-gray-400 italic leading-relaxed">
          {`"${item.note}"`}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <Link
          to={pluginDetailPath(item.type, item.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          {formatReflectionTime(item.checked_in_at, timeZone)}
        </Link>
      </div>
    </div>
  );
}

type Scrobble = {
  artists: string[];
  title: string;
  time: number;
};

function getLocalDateIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ReflectLoadingCard({ label }: { label: string }) {
  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-6 min-h-[220px] flex items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400">
      <Loader2 className="animate-spin text-primary-600" size={20} />
      <span>{label}</span>
    </div>
  );
}

function formatReflectionTime(dateStr: string, timeZone?: string | null) {
  const displayTimeZone = normalizeTimezoneForDisplay(timeZone);
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  }).format(new Date(dateStr));
}

function buildImmichDayUrl(immichUrl: string, date: string) {
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);
  const query = JSON.stringify({
    takenAfter: dayStart.toISOString(),
    takenBefore: dayEnd.toISOString(),
  });
  return `${immichUrl}/search?query=${encodeURIComponent(query)}`;
}

function buildDawarichDayUrl(dawarichUrl: string, date: string) {
  return `${dawarichUrl}/map/v2?end_at=${date}T23%3A59%3A59-04%3A00&start_at=${date}T00%3A00%3A00-04%3A00`;
}

function OnThisDaySection({
  data,
  moodIconPack,
  immichUrl,
  photosByYear,
  malojaUrl,
  scrobblesByDate,
  dawarichUrl,
}: {
  data: ReflectionYear[];
  moodIconPack: 'emoji' | 'lucide' | 'nature';
  immichUrl: string | null;
  photosByYear: Record<number, ImmichAsset[]>;
  malojaUrl: string | null;
  scrobblesByDate: Record<string, Scrobble[]>;
  dawarichUrl: string | null;
}) {
  if (data.length === 0) {
    return (
      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-2">
          <History size={16} className="text-purple-500" />
          On This Day
        </h3>
        <p className="text-sm text-gray-400">Nothing...</p>
      </div>
    );
  }

  function handleYearClick(year: ReflectionYear) {
    if (year.items.length === 0) return;
    const today = getLocalDateIso();
    const date = `${year.year}-${today.slice(5)}`;
    window.open(`/?from=${date}&to=${date}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <History size={16} className="text-purple-500" />
        On This Day
      </h3>
      <div className="space-y-4">
        {data.map((year) => {
          const sortedItems = [...year.items].sort(
            (a, b) =>
              new Date(a.checked_in_at).getTime() - new Date(b.checked_in_at).getTime()
          );
          const yearDate = sortedItems[0]?.checked_in_at.slice(0, 10) || null;
          const yearAssets = photosByYear[year.year] || [];

          return (
          <div key={year.year}>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => handleYearClick(year)}
                className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
              >
                {year.years_ago} year{year.years_ago !== 1 ? 's' : ''} ago
              </button>
              <span className="text-xs text-gray-400">{year.year}</span>
              {dawarichUrl && (() => {
                const now = new Date();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const date = `${year.year}-${month}-${day}`;
                const dawarichLink = buildDawarichDayUrl(dawarichUrl, date);
                return (
                  <a
                    href={dawarichLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                    title="Open in Dawarich"
                  >
                    <Compass size={14} />
                  </a>
                );
              })()}
            </div>
            <div className="space-y-3 ml-2 border-l-2 border-purple-100 dark:border-purple-800/40 pl-3">
              {sortedItems.map((item) => {
                const plugin = getClientPlugin(item.type);
                if (plugin) {
                  const Card = plugin.client.reflectionCard;
                  return Card ? (
                    <Card
                      key={`${item.type}-${item.id}`}
                      item={item as unknown as Parameters<typeof Card>[0]['item']}
                      settings={{} as Record<string, unknown>}
                    />
                  ) : (
                    <PluginReflectionFallback key={`${item.type}-${item.id}`} item={item} />
                  );
                }
                return <PluginReflectionFallback key={`${item.type}-${item.id}`} item={item} />;
              })}

              {immichUrl && yearDate && yearAssets.length > 0 && (
                <PhotoStrip
                  assets={yearAssets}
                  moreUrl={buildImmichDayUrl(immichUrl, yearDate)}
                  immichUrl={immichUrl}
                />
              )}

              {malojaUrl && yearDate && scrobblesByDate[yearDate] && scrobblesByDate[yearDate].length > 0 && (
                <MalojaScrobbleStrip
                  scrobbles={scrobblesByDate[yearDate]}
                  date={yearDate}
                  malojaUrl={malojaUrl}
                />
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReflectTab() {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [locationHeatmap, setLocationHeatmap] = useState<HeatmapDay[]>([]);
  const [moodHeatmap, setMoodHeatmap] = useState<MoodHeatmapPoint[]>([]);
  const [sleepHeatmap, setSleepHeatmap] = useState<SleepDailyPoint[]>([]);
  const [reflections, setReflections] = useState<ReflectionYear[]>([]);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [malojaUrl, setMalojaUrl] = useState<string | null>(null);
  const [dawarichUrl, setDawarichUrl] = useState<string | null>(null);
  const [photosByYear, setPhotosByYear] = useState<Record<number, ImmichAsset[]>>({});
  const [scrobblesByDate, setScrobblesByDate] = useState<Record<string, Scrobble[]>>({});
  const [moodIconPack, setMoodIconPack] = useState<'emoji' | 'lucide' | 'nature'>('emoji');
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [llmImageSupport, setLlmImageSupport] = useState(true);
  const [reflectionsLoading, setReflectionsLoading] = useState(true);
  const [locationLoading, setLocationLoading] = useState(true);
  const [moodLoading, setMoodLoading] = useState(true);
  const [sleepLoading, setSleepLoading] = useState(true);
  const [hasLoadedLocation, setHasLoadedLocation] = useState(false);
  const [hasLoadedMood, setHasLoadedMood] = useState(false);
  const [hasLoadedSleep, setHasLoadedSleep] = useState(false);
  const currentYear = new Date().getFullYear();
  const heatmapsRefreshing = locationLoading || moodLoading || sleepLoading;

  // Mood icon pack is a mood-plugin setting, so load it from the plugin
  // settings store (not the core user_settings).
  useEffect(() => {
    plugins
      .settings.get('mood')
      .then((s) => {
        if (s?.mood_icon_pack === 'emoji' || s?.mood_icon_pack === 'lucide' || s?.mood_icon_pack === 'nature') {
          setMoodIconPack(s.mood_icon_pack);
        }
      })
      .catch(() => {});
  }, []);


  useEffect(() => {
    let cancelled = false;
    setReflectionsLoading(true);

    Promise.all([stats.reflections(USER_ID, getLocalDateIso()), settings.get()])
      .then(([data, userSettings]) => {
        if (cancelled) return;
        setReflections(data);
        if (userSettings?.immich_url) {
          setImmichUrl(userSettings.immich_url.replace(/\/+$/, ''));
        } else {
          setImmichUrl(null);
        }
        if (userSettings?.maloja_url) {
          setMalojaUrl(userSettings.maloja_url.replace(/\/+$/, ''));
        } else {
          setMalojaUrl(null);
        }
        if (userSettings?.dawarich_url) {
          setDawarichUrl(userSettings.dawarich_url.replace(/\/+$/, ''));
        } else {
          setDawarichUrl(null);
        }
        setLlmConfigured(Boolean(userSettings?.llm_api_url && userSettings?.llm_model));
        setLlmImageSupport(userSettings?.llm_image_support !== false);
      })
      .catch((err) => {
        console.error('Failed to load reflect data:', err);
        if (!cancelled) {
          setReflections([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setReflectionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!malojaUrl || reflections.length === 0) {
      setScrobblesByDate({});
      return () => {
        cancelled = true;
      };
    }

    // Collect all unique dates from reflections
    const uniqueDates = new Set<string>();
    for (const year of reflections) {
      for (const item of year.items) {
        const date = item.checked_in_at.slice(0, 10);
        uniqueDates.add(date);
      }
    }

    if (uniqueDates.size === 0) {
      setScrobblesByDate({});
      return () => {
        cancelled = true;
      };
    }

    // Convert date format from YYYY-MM-DD to YYYY/MM/DD for Maloja
    const malojaDateFormat = (dateStr: string) => {
      return dateStr.replace(/-/g, '/');
    };

    // Fetch scrobbles for each unique date
    Promise.all(
      Array.from(uniqueDates).map((date) =>
        scrobbles
          .forDate(malojaDateFormat(date))
          .then((scrobbleList) => ({ date, scrobbles: scrobbleList }))
          .catch((err) => {
            console.error(`Failed to fetch scrobbles for ${date}:`, err);
            return { date, scrobbles: [] };
          })
      )
    )
      .then((results) => {
        if (cancelled) return;

        const byDate: Record<string, Scrobble[]> = {};
        for (const { date, scrobbles: scrobbleList } of results) {
          byDate[date] = scrobbleList;
        }

        setScrobblesByDate(byDate);
      })
      .catch((err) => {
        console.error('Failed to load reflection scrobbles:', err);
        if (!cancelled) {
          setScrobblesByDate({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [malojaUrl, reflections]);

  useEffect(() => {
    let cancelled = false;

    if (!immichUrl || reflections.length === 0) {
      setPhotosByYear({});
      return () => {
        cancelled = true;
      };
    }

    const yearToCheckinIds = new Map<number, string[]>();
    const allCheckinIds: string[] = [];

    for (const year of reflections) {
      const ids = year.items.map((item) => item.id);
      yearToCheckinIds.set(year.year, ids);
      allCheckinIds.push(...ids);
    }

    if (allCheckinIds.length === 0) {
      setPhotosByYear({});
      return () => {
        cancelled = true;
      };
    }

    const batches: string[][] = [];
    for (let i = 0; i < allCheckinIds.length; i += IMMICH_CHECKIN_BATCH_SIZE) {
      batches.push(allCheckinIds.slice(i, i + IMMICH_CHECKIN_BATCH_SIZE));
    }

    Promise.all(batches.map((batch) => immichApi.photosForCheckins(batch)))
      .then((batchMaps) => {
        if (cancelled) return;

        const photoMap: Record<string, ImmichAsset[]> = {};
        for (const batchMap of batchMaps) {
          for (const [checkinId, assets] of Object.entries(batchMap)) {
            photoMap[checkinId] = assets;
          }
        }

        const byYear: Record<number, ImmichAsset[]> = {};

        for (const [year, ids] of yearToCheckinIds.entries()) {
          const deduped = new Map<string, ImmichAsset>();
          for (const checkinId of ids) {
            for (const asset of photoMap[checkinId] || []) {
              if (!deduped.has(asset.id)) {
                deduped.set(asset.id, asset);
              }
            }
          }
          byYear[year] = Array.from(deduped.values());
        }

        setPhotosByYear(byYear);
      })
      .catch((err) => {
        console.error('Failed to load reflection photos:', err);
        if (!cancelled) {
          setPhotosByYear({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [immichUrl, reflections]);

  useEffect(() => {
    let cancelled = false;
    setLocationLoading(true);

    stats.heatmap(USER_ID, selectedYear)
      .then((data) => {
        if (!cancelled) {
          setLocationHeatmap(data);
        }
      })
      .catch((err) => {
        console.error('Failed to load location heatmap:', err);
        if (!cancelled) {
          setLocationHeatmap([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLocationLoading(false);
          setHasLoadedLocation(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYear]);

  useEffect(() => {
    let cancelled = false;
    setMoodLoading(true);

    moodStats.heatmap(USER_ID, selectedYear)
      .then((data) => {
        if (!cancelled) {
          setMoodHeatmap(data);
        }
      })
      .catch((err) => {
        console.error('Failed to load mood heatmap:', err);
        if (!cancelled) {
          setMoodHeatmap([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMoodLoading(false);
          setHasLoadedMood(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYear]);

  useEffect(() => {
    let cancelled = false;
    setSleepLoading(true);

    const from = `${selectedYear}-01-01`;
    const to = `${selectedYear}-12-31`;

    sleepStats.daily(USER_ID, from, to)
      .then((data) => {
        if (!cancelled) {
          setSleepHeatmap(data);
        }
      })
      .catch((err) => {
        console.error('Failed to load sleep heatmap:', err);
        if (!cancelled) {
          setSleepHeatmap([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSleepLoading(false);
          setHasLoadedSleep(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedYear]);

  return (
    <div className="space-y-6">
      {reflectionsLoading ? (
        <ReflectLoadingCard label="Loading reflections" />
      ) : (
        <OnThisDaySection
          data={reflections}
          moodIconPack={moodIconPack}
          immichUrl={immichUrl}
          photosByYear={photosByYear}
          malojaUrl={malojaUrl}
          scrobblesByDate={scrobblesByDate}
          dawarichUrl={dawarichUrl}
        />
      )}

      <LifeSummarySection
        llmConfig={{
          configured: llmConfigured,
          imageSupport: llmImageSupport,
        }}
      />

      <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4 space-y-4">
        <div className="flex items-center justify-start gap-3">
          <CalendarDays size={16} className="text-purple-500" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedYear(selectedYear - 1)}
              disabled={heatmapsRefreshing}
              className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              &larr; {selectedYear - 1}
            </button>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 min-w-12 text-center">
              {selectedYear}
            </span>
            {selectedYear < currentYear && (
              <button
                onClick={() => setSelectedYear(selectedYear + 1)}
                disabled={heatmapsRefreshing}
                className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {selectedYear + 1} &rarr;
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
        {locationLoading && !hasLoadedLocation ? (
          <ReflectLoadingCard label="Loading location heatmap" />
        ) : (
          <div className={`relative transition-opacity ${locationLoading ? 'opacity-80' : 'opacity-100'}`}>
            <Heatmap
              days={locationHeatmap}
              year={selectedYear}
              showTitleIcon={true}
              showTitleYear={false}
              onDayClick={(date) => window.open(`/?from=${date}&to=${date}`, '_blank', 'noopener,noreferrer')}
            />
            {locationLoading && (
              <div className="absolute inset-0 rounded-2xl bg-white/35 dark:bg-gray-900/35 pointer-events-auto cursor-wait flex items-start justify-end p-3">
                <Loader2 className="animate-spin text-primary-600" size={16} />
              </div>
            )}
          </div>
        )}

        {moodLoading && !hasLoadedMood ? (
          <ReflectLoadingCard label="Loading mood heatmap" />
        ) : (
          <div className={`relative transition-opacity ${moodLoading ? 'opacity-80' : 'opacity-100'}`}>
            <MoodYearInPixels
              data={moodHeatmap}
              year={selectedYear}
              onYearChange={setSelectedYear}
              showYearControls={false}
              showTitleIcon={true}
              showTitleYear={false}
            />
            {moodLoading && (
              <div className="absolute inset-0 rounded-2xl bg-white/35 dark:bg-gray-900/35 pointer-events-auto cursor-wait flex items-start justify-end p-3">
                <Loader2 className="animate-spin text-primary-600" size={16} />
              </div>
            )}
          </div>
        )}

        {sleepLoading && !hasLoadedSleep ? (
          <ReflectLoadingCard label="Loading sleep heatmap" />
        ) : (
          <div className={`relative transition-opacity ${sleepLoading ? 'opacity-80' : 'opacity-100'}`}>
            <SleepYearInPixels
              data={sleepHeatmap}
              year={selectedYear}
            />
            {sleepLoading && (
              <div className="absolute inset-0 rounded-2xl bg-white/35 dark:bg-gray-900/35 pointer-events-auto cursor-wait flex items-start justify-end p-3">
                <Loader2 className="animate-spin text-primary-600" size={16} />
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}