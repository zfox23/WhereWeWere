import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Library, List, Loader2, MapPin } from 'lucide-react';
import { stats } from '../../../client/src/api/client';
import { PeriodRangeSelector } from '../../../client/src/components/PeriodRangeSelector';
import { StatCard } from '../../../client/src/components/Stats';
import {
  PeriodMode,
  getCurrentDateIso,
  getCurrentMonthIso,
  getPeriodDateRange,
  getPeriodRangeLabel,
  isValidDateParam,
  isValidMonthParam,
  parsePeriodParam,
} from '../../../client/src/utils/periodRange';
import type {
  CategoryBreakdown,
  CountryStats,
  MapDataPoint,
  Stats as StatsType,
  TopVenue,
} from '../../../client/src/types';
import {
  BusiestDays,
  CategoryChart,
  CountriesList,
  DayOfWeekChart,
  TimeOfDayChart,
  TopCities,
  TopVenuesList,
  type BusiestDayData,
  type CityData,
  type DayOfWeekData,
  type TimeOfDayData,
} from './LocationStats';
import { VenuePinsMap } from './VenuePinsMap';
import { VenuesLibrarySection } from './VenuesLibrarySection';
import { CheckinListsSection } from './CheckinListsSection';
import { VenueListsSection } from './VenueListsSection';

type PlacesSection = 'venues' | 'lists' | 'map';

const PLACES_SECTIONS: { key: PlacesSection; label: string; icon: React.ElementType }[] = [
  { key: 'map', label: 'Map & Stats', icon: MapPin },
  { key: 'lists', label: 'Lists', icon: List },
  { key: 'venues', label: 'Venue Library', icon: Library },
];

function getPlacesSectionFromLocation(): PlacesSection {
  const section = new URLSearchParams(window.location.search).get('placesSection');
  return section === 'venues' || section === 'lists' || section === 'map' ? section : 'map';
}

export function PlacesTab() {
  const getPlacesMonthFromLocation = (): string => {
    const monthParam = new URLSearchParams(window.location.search).get('placesMonth');
    return isValidMonthParam(monthParam) ? monthParam : getCurrentMonthIso();
  };

  const getPlacesPeriodFromLocation = (): PeriodMode => {
    return parsePeriodParam(new URLSearchParams(window.location.search).get('placesPeriod')) ?? 'single';
  };

  const getPlacesWeekFromLocation = (): string => {
    const weekParam = new URLSearchParams(window.location.search).get('placesWeek');
    return isValidDateParam(weekParam) ? weekParam : getCurrentDateIso();
  };

  const [placesPeriodMode, setPlacesPeriodMode] = useState<PeriodMode>(getPlacesPeriodFromLocation);
  const [placesSelectedMonth, setPlacesSelectedMonth] = useState<string>(getPlacesMonthFromLocation);
  const [placesSelectedWeek, setPlacesSelectedWeek] = useState<string>(getPlacesWeekFromLocation);
  const [placesSection, setPlacesSection] = useState<PlacesSection>(getPlacesSectionFromLocation);
  const [placesYear, setPlacesYear] = useState(() => parseInt(getPlacesMonthFromLocation().slice(0, 4), 10));
  const [summary, setSummary] = useState<StatsType | null>(null);
  const [topVenues, setTopVenues] = useState<TopVenue[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [countries, setCountries] = useState<CountryStats[]>([]);
  const [mapData, setMapData] = useState<MapDataPoint[]>([]);
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeekData[]>([]);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayData[]>([]);
  const [busiestDays, setBusiestDays] = useState<BusiestDayData[]>([]);
  const [topCities, setTopCities] = useState<CityData[]>([]);
  const [placesLoading, setPlacesLoading] = useState(true);
  const [initialPlacesLoaded, setInitialPlacesLoaded] = useState(false);
  const [earliestCheckinDate, setEarliestCheckinDate] = useState<string | null>(null);

  const placesVisibleRange = useMemo(
    () => getPeriodDateRange(placesSelectedMonth, placesPeriodMode, placesSelectedWeek),
    [placesSelectedMonth, placesPeriodMode, placesSelectedWeek]
  );
  const placesRangeLabel = useMemo(
    () => getPeriodRangeLabel(placesSelectedMonth, placesPeriodMode, placesSelectedWeek),
    [placesSelectedMonth, placesPeriodMode, placesSelectedWeek]
  );

  useEffect(() => {
    stats.earliestDates().then((d) => setEarliestCheckinDate(d.checkins)).catch(console.error);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlacesLoading(true);

    Promise.all([
      stats.summary(
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.topVenues(
        10,
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.categoryBreakdown(
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.countries(
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.mapData(
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.dayOfWeek(
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.timeOfDay(
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.busiestDays(
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
      stats.topCities(
        placesVisibleRange.from || undefined,
        placesVisibleRange.to || undefined
      ),
    ])
      .then(([s, tv, cb, co, md, dow, tod, bd, tc]) => {
        if (cancelled) {
          return;
        }

        setSummary(s);
        setTopVenues(tv);
        setCategories(cb);
        setCountries(co);
        setMapData(md.map((item: MapDataPoint) => ({
          ...item,
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
        })));
        setDayOfWeek(dow);
        setTimeOfDay(tod);
        setBusiestDays(bd);
        setTopCities(tc);
      })
      .catch((err) => {
        console.error('Failed to load filtered profile data:', err);
        if (!cancelled) {
          setSummary(null);
          setTopVenues([]);
          setCategories([]);
          setCountries([]);
          setMapData([]);
          setDayOfWeek([]);
          setTimeOfDay([]);
          setBusiestDays([]);
          setTopCities([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPlacesLoading(false);
          setInitialPlacesLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [placesVisibleRange.from, placesVisibleRange.to]);

  useEffect(() => {
    const syncStateFromLocation = () => {
      const nextMonth = getPlacesMonthFromLocation();
      setPlacesSelectedMonth(nextMonth);
      setPlacesSelectedWeek(getPlacesWeekFromLocation());
      setPlacesYear(parseInt(nextMonth.slice(0, 4), 10));
      setPlacesPeriodMode(getPlacesPeriodFromLocation());
      setPlacesSection(getPlacesSectionFromLocation());
    };

    syncStateFromLocation();
    window.addEventListener('popstate', syncStateFromLocation);
    window.addEventListener('hashchange', syncStateFromLocation);

    return () => {
      window.removeEventListener('popstate', syncStateFromLocation);
      window.removeEventListener('hashchange', syncStateFromLocation);
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;

    if (url.searchParams.get('tab') !== 'plugin:location') {
      url.searchParams.set('tab', 'plugin:location');
      changed = true;
    }
    // Only persist non-default filter values so the URL stays short.
    const setOrDelete = (key: string, value: string, isDefault: boolean) => {
      if (isDefault) {
        if (url.searchParams.has(key)) {
          url.searchParams.delete(key);
          changed = true;
        }
      } else if (url.searchParams.get(key) !== value) {
        url.searchParams.set(key, value);
        changed = true;
      }
    };
    setOrDelete('placesMonth', placesSelectedMonth, placesSelectedMonth === getCurrentMonthIso());
    setOrDelete('placesPeriod', placesPeriodMode, placesPeriodMode === 'single');
    setOrDelete('placesWeek', placesSelectedWeek, placesSelectedWeek === getCurrentDateIso());
    setOrDelete('placesSection', placesSection, placesSection === 'map');

    if (changed) {
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [placesPeriodMode, placesSelectedMonth, placesSelectedWeek, placesSection]);

  if (!initialPlacesLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800/60 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        {PLACES_SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setPlacesSection(key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${placesSection === key
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {placesSection === 'map' && (
        <>
          <div className="flex items-center gap-2">
            <PeriodRangeSelector
              periodMode={placesPeriodMode}
              onPeriodModeChange={setPlacesPeriodMode}
              year={placesYear}
              onYearChange={setPlacesYear}
              selectedMonth={placesSelectedMonth}
              onSelectedMonthChange={setPlacesSelectedMonth}
              selectedWeek={placesSelectedWeek}
              onSelectedWeekChange={setPlacesSelectedWeek}
              allTimeStartDate={earliestCheckinDate ?? undefined}
              onOpenHome={() => {
                if (placesVisibleRange.from && placesVisibleRange.to) {
                  window.open(`/?from=${placesVisibleRange.from}&to=${placesVisibleRange.to}`, '_blank', 'noopener,noreferrer');
                } else {
                  window.open('/', '_blank', 'noopener,noreferrer');
                }
              }}
            />
          </div>

        {summary && (
          <div className="grid grid-cols-3 gap-1.5 md:gap-3">
            <StatCard icon={MapPin} label="Check-ins" value={summary.total_checkins} />
            <StatCard icon={MapPin} label="Unique" value={summary.unique_venues} />
            <StatCard icon={CalendarDays} label="Active Days" value={summary.days_with_checkins} />
          </div>
        )}

        <VenuePinsMap
          data={mapData}
          loading={placesLoading}
          periodLabel={placesRangeLabel}
          range={placesVisibleRange}
        />

        <div className="grid md:grid-cols-2 gap-4">
          <TopVenuesList venues={topVenues} />
          <CategoryChart data={categories} />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <DayOfWeekChart data={dayOfWeek} />
          <TimeOfDayChart data={timeOfDay} />
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <BusiestDays data={busiestDays} />
          <TopCities data={topCities} />
        </div>

        <CountriesList data={countries} />
        </>
      )}

      {placesSection === 'lists' && (
        <div className="space-y-6">
          <section aria-labelledby="checkin-lists-heading" className="space-y-2">
            <h3 id="checkin-lists-heading" className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Checkin lists
            </h3>
            <CheckinListsSection />
          </section>
          <section aria-labelledby="venue-lists-heading" className="space-y-2">
            <h3 id="venue-lists-heading" className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Venue lists
            </h3>
            <VenueListsSection />
          </section>
        </div>
      )}

      {placesSection === 'venues' && <VenuesLibrarySection from="" to="" />}
    </div>
  );
}
