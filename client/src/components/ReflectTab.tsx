import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, History, Loader2, MapPin, SmilePlus } from 'lucide-react';
import { settings, stats } from '../api/client';
import { MoodIcon, MOOD_LABELS, MOOD_COLORS } from './MoodIcons';
import { MoodYearInPixels } from './MoodStats';
import { Heatmap } from './Stats';
import { normalizeTimezoneForDisplay } from '../utils/checkin';
import { resolveActivityIcon } from '../utils/icons';
import type { HeatmapDay, UserSettings } from '../types';

const USER_ID = '00000000-0000-0000-0000-000000000001';

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

function OnThisDaySection({
  data,
  moodIconPack,
}: {
  data: ReflectionYear[];
  moodIconPack: UserSettings['mood_icon_pack'];
}) {
  const navigate = useNavigate();

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
    navigate(`/?from=${date}&to=${date}`);
  }

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-3">
        <History size={16} className="text-purple-500" />
        On This Day
      </h3>
      <div className="space-y-4">
        {data.map((year) => (
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
              {year.items.reverse().map((item) => {
                const detailHref = item.type === 'location'
                  ? `/venues/${item.venue_id}`
                  : `/mood-checkins/${item.id}`;
                const title = item.type === 'location'
                  ? item.venue_name
                  : item.mood && item.mood >= 1 && item.mood <= 5
                    ? MOOD_LABELS[item.mood]
                    : 'Mood check-in';
                const timeZone = item.type === 'location' ? item.venue_timezone : item.mood_timezone;

                return (
                  <div key={`${item.type}-${item.id}`} className="text-xs space-y-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                      <Link to={detailHref} className="font-medium text-gray-600 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
                        {formatReflectionTime(item.checked_in_at, timeZone)}
                      </Link>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.type === 'mood' && item.mood ? (
                        <span className={`font-semibold ${MOOD_COLORS[item.mood] || 'text-gray-700 dark:text-gray-300'}`}>
                          {title}
                        </span>
                      ) : null}
                      <Link to={detailHref} className="font-medium text-gray-900 dark:text-gray-100 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
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
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReflectTab() {
  const navigate = useNavigate();
  const [locationYear, setLocationYear] = useState(new Date().getFullYear());
  const [moodYear, setMoodYear] = useState(new Date().getFullYear());
  const [locationHeatmap, setLocationHeatmap] = useState<HeatmapDay[]>([]);
  const [moodHeatmap, setMoodHeatmap] = useState<MoodHeatmapPoint[]>([]);
  const [reflections, setReflections] = useState<ReflectionYear[]>([]);
  const [moodIconPack, setMoodIconPack] = useState<UserSettings['mood_icon_pack']>('emoji');
  const [reflectionsLoading, setReflectionsLoading] = useState(true);
  const [locationLoading, setLocationLoading] = useState(true);
  const [moodLoading, setMoodLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setReflectionsLoading(true);

    Promise.all([stats.reflections(USER_ID), settings.get()])
      .then(([data, userSettings]) => {
        if (cancelled) return;
        setReflections(data);
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
    setLocationLoading(true);

    stats.heatmap(USER_ID, locationYear)
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
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locationYear]);

  useEffect(() => {
    let cancelled = false;
    setMoodLoading(true);

    stats.moodHeatmap(USER_ID, moodYear)
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
        }
      });

    return () => {
      cancelled = true;
    };
  }, [moodYear]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-2">
        {locationLoading ? (
          <ReflectLoadingCard label="Loading location heatmap" />
        ) : (
          <Heatmap
            days={locationHeatmap}
            year={locationYear}
            onYearChange={setLocationYear}
            onDayClick={(date) => navigate(`/?from=${date}&to=${date}`)}
          />
        )}

        {moodLoading ? (
          <ReflectLoadingCard label="Loading mood heatmap" />
        ) : (
          <MoodYearInPixels data={moodHeatmap} year={moodYear} onYearChange={setMoodYear} />
        )}
      </div>

      {reflectionsLoading ? (
        <ReflectLoadingCard label="Loading reflections" />
      ) : (
        <OnThisDaySection data={reflections} moodIconPack={moodIconPack} />
      )}
    </div>
  );
}