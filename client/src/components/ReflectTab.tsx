import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, History, Loader2, MapPin, SmilePlus } from 'lucide-react';
import { immich as immichApi, settings, stats, scrobbles } from '../api/client';
import { MoodIcon, MOOD_LABELS, MOOD_COLORS } from './MoodIcons';
import { MoodYearInPixels } from './MoodStats';
import { PhotoStrip } from './PhotoStrip';
import { MalojaScrobbleStrip } from './MalojaScrobbleStrip';
import { Heatmap } from './Stats';
import { normalizeTimezoneForDisplay } from '../utils/checkin';
import { resolveActivityIcon } from '../utils/icons';
import type { HeatmapDay, ImmichAsset, UserSettings } from '../types';

const USER_ID = '00000000-0000-0000-0000-000000000001';
const IMMICH_CHECKIN_BATCH_SIZE = 30;

type ReflectionItem = {
  type: 'location' | 'mood';
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
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 min-h-[220px] flex items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400">
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

function OnThisDaySection({
  data,
  moodIconPack,
  immichUrl,
  photosByYear,
  malojaUrl,
  scrobblesByDate,
}: {
  data: ReflectionYear[];
  moodIconPack: UserSettings['mood_icon_pack'];
  immichUrl: string | null;
  photosByYear: Record<number, ImmichAsset[]>;
  malojaUrl: string | null;
  scrobblesByDate: Record<string, Scrobble[]>;
}) {
  if (data.length === 0) {
    return (
      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-2">
          <History size={16} className="text-purple-500" />
          On This Day
        </h3>
        <p className="text-sm text-gray-400">Nothing...</p>
      </div>
    );
  }

  function handleYearClick(items: ReflectionItem[]) {
    if (items.length === 0) return;
    const date = items[0].checked_in_at.slice(0, 10);
    window.open(`/?from=${date}&to=${date}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
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
                onClick={() => handleYearClick(year.items)}
                className="text-xs font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/30 px-2 py-0.5 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors"
              >
                {year.years_ago} year{year.years_ago !== 1 ? 's' : ''} ago
              </button>
              <span className="text-xs text-gray-400">{year.year}</span>
            </div>
            <div className="space-y-3 ml-2 border-l-2 border-purple-100 dark:border-purple-800/40 pl-3">
              {sortedItems.map((item) => {
                const detailHref = item.type === 'location'
                  ? `/venues/${item.venue_id}`
                  : `/mood-checkins/${item.id}`;
                const timeHref = item.type === 'location'
                  ? `/checkins/${item.id}`
                  : `/mood-checkins/${item.id}`;
                const title = item.type === 'location'
                  ? item.venue_name
                  : item.mood && item.mood >= 1 && item.mood <= 5
                    ? MOOD_LABELS[item.mood]
                    : 'Mood check-in';
                const timeZone = item.type === 'location' ? item.venue_timezone : item.mood_timezone;

                return (
                  <div key={`${item.type}-${item.id}`} className="text-xs space-y-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.type === 'mood' && item.mood ? (
                        <span className={`font-semibold ${MOOD_COLORS[item.mood] || 'text-gray-700 dark:text-gray-300'}`}>
                          {title}
                        </span>
                      ) : null}
                      <Link to={detailHref} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                        {item.type === 'location' ? title : ''}
                      </Link>
                      {item.type === 'location' && (item.venue_category || item.city) ? (
                        <span className="text-gray-500 dark:text-gray-400">
                          {item.venue_category}
                          {item.city ? ` · ${item.city}${item.country ? `, ${item.country}` : ''}` : ''}
                        </span>
                      ) : null}
                    </div>
                    {item.note ? (
                      <p className="text-gray-600 dark:text-gray-400 italic leading-relaxed">
                        {`"${item.note}"`}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      <Link to={timeHref} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                        {formatReflectionTime(item.checked_in_at, timeZone)}
                      </Link>
                    </div>
                  </div>
                );
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
  const [reflections, setReflections] = useState<ReflectionYear[]>([]);
  const [immichUrl, setImmichUrl] = useState<string | null>(null);
  const [malojaUrl, setMalojaUrl] = useState<string | null>(null);
  const [photosByYear, setPhotosByYear] = useState<Record<number, ImmichAsset[]>>({});
  const [scrobblesByDate, setScrobblesByDate] = useState<Record<string, Scrobble[]>>({});
  const [moodIconPack, setMoodIconPack] = useState<UserSettings['mood_icon_pack']>('emoji');
  const [reflectionsLoading, setReflectionsLoading] = useState(true);
  const [locationLoading, setLocationLoading] = useState(true);
  const [moodLoading, setMoodLoading] = useState(true);
  const [hasLoadedLocation, setHasLoadedLocation] = useState(false);
  const [hasLoadedMood, setHasLoadedMood] = useState(false);
  const currentYear = new Date().getFullYear();
  const heatmapsRefreshing = locationLoading || moodLoading;

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
        if (userSettings?.mood_icon_pack) {
          setMoodIconPack(userSettings.mood_icon_pack);
        }
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

    stats.moodHeatmap(USER_ID, selectedYear)
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
        />
      )}

      <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4 space-y-4">
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
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 min-w-[3rem] text-center">
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
              <div className="absolute inset-0 rounded-2xl bg-white/35 dark:bg-gray-900/35 backdrop-blur-[1px] pointer-events-auto cursor-wait flex items-start justify-end p-3">
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
              <div className="absolute inset-0 rounded-2xl bg-white/35 dark:bg-gray-900/35 backdrop-blur-[1px] pointer-events-auto cursor-wait flex items-start justify-end p-3">
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