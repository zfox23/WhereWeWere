import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import LocationFilter from './LocationFilter';
import MoodFilter, { ActivityOption } from './MoodFilter';
import SleepFilter from './SleepFilter';
import TrackFilter from './TrackFilter';

const COMPLETE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface FiltersProps {
  hasActiveFilters: boolean;
  fromDate: string;
  toDate: string;
  category: string;
  country: string;
  mood: string;
  activity: string;
  sleepDuration: string;
  trackActivity: string;
  includeLocation: boolean;
  includeMood: boolean;
  includeSleep: boolean;
  includeTrack: boolean;
  categoryOptions: string[];
  countryOptions: string[];
  activityOptions: ActivityOption[];
  trackActivityOptions: string[];
  moodTypeToggleDisabled: boolean;
  locationTypeToggleDisabled: boolean;
  sleepTypeToggleDisabled: boolean;
  trackTypeToggleDisabled: boolean;
  moodFiltersDisabled: boolean;
  locationFiltersDisabled: boolean;
  sleepFiltersDisabled: boolean;
  trackFiltersDisabled: boolean;
  moodSectionDisabled: boolean;
  locationSectionDisabled: boolean;
  sleepSectionDisabled: boolean;
  trackSectionDisabled: boolean;
  onSetDateFilter: (key: 'from' | 'to', value: string) => void;
  onToggleLocationType: () => void;
  onToggleMoodType: () => void;
  onToggleSleepType: () => void;
  onToggleTrackType: () => void;
  onSetMoodFilter: (key: 'mood' | 'activity', value: string) => void;
  onSetLocationFilter: (key: 'venue_id' | 'category' | 'country', value: string) => void;
  onSetSleepFilter: (value: string) => void;
  onSetTrackFilter: (value: string) => void;
  onClearAll: () => void;
}

export default function Filters(props: FiltersProps) {
  const {
    hasActiveFilters,
    fromDate,
    toDate,
    category,
    country,
    mood,
    activity,
    sleepDuration,
    trackActivity,
    includeLocation,
    includeMood,
    includeSleep,
    includeTrack,
    categoryOptions,
    countryOptions,
    activityOptions,
    trackActivityOptions,
    moodTypeToggleDisabled,
    locationTypeToggleDisabled,
    sleepTypeToggleDisabled,
    trackTypeToggleDisabled,
    moodFiltersDisabled,
    locationFiltersDisabled,
    sleepFiltersDisabled,
    trackFiltersDisabled,
    moodSectionDisabled,
    locationSectionDisabled,
    sleepSectionDisabled,
    trackSectionDisabled,
    onSetDateFilter,
    onToggleLocationType,
    onToggleMoodType,
    onToggleSleepType,
    onToggleTrackType,
    onSetMoodFilter,
    onSetLocationFilter,
    onSetSleepFilter,
    onSetTrackFilter,
    onClearAll,
  } = props;

  const [fromDateInput, setFromDateInput] = useState(fromDate);
  const [toDateInput, setToDateInput] = useState(toDate);

  useEffect(() => {
    setFromDateInput(fromDate);
  }, [fromDate]);

  useEffect(() => {
    setToDateInput(toDate);
  }, [toDate]);

  const handleDateInputChange = (key: 'from' | 'to', value: string) => {
    if (key === 'from') {
      setFromDateInput(value);
    } else {
      setToDateInput(value);
    }

    if (!value) {
      onSetDateFilter(key, '');
    }
  };

  const commitDateInput = (key: 'from' | 'to') => {
    const value = key === 'from' ? fromDateInput : toDateInput;
    if (!value) {
      onSetDateFilter(key, '');
      return;
    }

    if (COMPLETE_DATE_PATTERN.test(value)) {
      onSetDateFilter(key, value);
      return;
    }

    if (key === 'from') {
      setFromDateInput(fromDate);
    } else {
      setToDateInput(toDate);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters</span>
        {hasActiveFilters && (
          <button
            onClick={onClearAll}
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
            value={fromDateInput}
            onChange={(e) => handleDateInputChange('from', e.target.value)}
            onBlur={() => commitDateInput('from')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitDateInput('from');
              }
            }}
            className="input"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Before</label>
          <input
            type="date"
            value={toDateInput}
            onChange={(e) => handleDateInputChange('to', e.target.value)}
            onBlur={() => commitDateInput('to')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitDateInput('to');
              }
            }}
            className="input"
          />
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3 items-start">
        <LocationFilter
          included={includeLocation}
          filtersDisabled={locationFiltersDisabled}
          sectionDisabled={locationSectionDisabled}
          typeToggleDisabled={locationTypeToggleDisabled}
          category={category}
          country={country}
          categoryOptions={categoryOptions}
          countryOptions={countryOptions}
          onToggleIncluded={onToggleLocationType}
          onSetCategory={(value) => onSetLocationFilter('category', value)}
          onSetCountry={(value) => onSetLocationFilter('country', value)}
        />

        <MoodFilter
          included={includeMood}
          filtersDisabled={moodFiltersDisabled}
          sectionDisabled={moodSectionDisabled}
          typeToggleDisabled={moodTypeToggleDisabled}
          mood={mood}
          activity={activity}
          activityOptions={activityOptions}
          onToggleIncluded={onToggleMoodType}
          onSetMood={(value) => onSetMoodFilter('mood', value)}
          onSetActivity={(value) => onSetMoodFilter('activity', value)}
        />

        <SleepFilter
          included={includeSleep}
          filtersDisabled={sleepFiltersDisabled}
          sectionDisabled={sleepSectionDisabled}
          typeToggleDisabled={sleepTypeToggleDisabled}
          sleepDuration={sleepDuration}
          onToggleIncluded={onToggleSleepType}
          onSetSleepDuration={onSetSleepFilter}
        />

        <TrackFilter
          included={includeTrack}
          filtersDisabled={trackFiltersDisabled}
          sectionDisabled={trackSectionDisabled}
          typeToggleDisabled={trackTypeToggleDisabled}
          trackActivity={trackActivity}
          trackActivityOptions={trackActivityOptions}
          onToggleIncluded={onToggleTrackType}
          onSetTrackActivity={onSetTrackFilter}
        />
      </div>
    </div>
  );
}
