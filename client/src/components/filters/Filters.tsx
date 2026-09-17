import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { X, Check } from 'lucide-react';
import LocationFilter from './LocationFilter';
import TrackFilter from './TrackFilter';
import MediaFilter from './MediaFilter';
import type { CheckinTypeClient, PluginFilterSectionProps } from 'wwp-shared';

const COMPLETE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A plugin's active filter params (name -> value). */
export type PluginFilterParams = Record<string, Record<string, string>>;

/** One row describing a plugin for the filters panel. */
export interface PluginFilterSpec {
  plugin: CheckinTypeClient;
  included: boolean;
  filtersDisabled: boolean;
  sectionDisabled: boolean;
  typeToggleDisabled: boolean;
  params: Record<string, string>;
  onToggleIncluded: () => void;
  onSetParam: (name: string, value: string) => void;
}

/**
 * Default filter section: a type toggle plus one control per declared
 * filter param (equality select driven by the matching field's options).
 * Used when a plugin does not ship its own `filterSection`.
 */
function DefaultPluginFilterSection({ spec }: { spec: PluginFilterSpec }) {
  const { plugin } = spec;
  const Icon = plugin.client.icon as React.ElementType<{ size?: number; className?: string }>;
  const params = plugin.filterParams ?? [];

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={spec.onToggleIncluded}
        disabled={spec.typeToggleDisabled}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
          spec.included
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
            : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-400'
        } ${spec.typeToggleDisabled ? 'opacity-50' : ''}`}
      >
        <Icon size={16} className={plugin.client.iconColor} />
        {plugin.strings.title}
        {spec.included && <Check size={14} className="ml-auto" />}
      </button>

      {!spec.sectionDisabled &&
        params.map((param) => {
          const field = plugin.fields.find((f) => f.name === param || (f.options && f.options.length > 0));
          const options = field?.options ?? [];
          return (
            <select
              key={param}
              value={spec.params[param] ?? ''}
              disabled={spec.filtersDisabled}
              onChange={(e) => spec.onSetParam(param, e.target.value)}
              className="input text-sm"
            >
              <option value="">All {field?.label.toLowerCase() ?? param}s</option>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.icon ? `${opt.icon} ` : ''}{opt.label}
                </option>
              ))}
            </select>
          );
        })}
    </div>
  );
}

/**
 * Renders a plugin's filter section: the plugin's own `filterSection` when
 * provided, otherwise the default toggle + param controls.
 */
function PluginFilterSlot({ spec }: { spec: PluginFilterSpec }) {
  const CustomSection = spec.plugin.client.filterSection;
  if (CustomSection) {
    return (
      <CustomSection
        included={spec.included}
        filtersDisabled={spec.filtersDisabled}
        sectionDisabled={spec.sectionDisabled}
        typeToggleDisabled={spec.typeToggleDisabled}
        params={spec.params}
        onToggleIncluded={spec.onToggleIncluded}
        onSetParam={spec.onSetParam}
      />
    );
  }
  return <DefaultPluginFilterSection spec={spec} />;
}

export interface FiltersProps {
  hasActiveFilters: boolean;
  fromDate: string;
  toDate: string;
  category: string;
  country: string;
  trackActivity: string;
  mediaSubtypes: string;
  includeLocation: boolean;
  includeTrack: boolean;
  includeMedia: boolean;
  categoryOptions: string[];
  countryOptions: string[];
  trackActivityOptions: string[];
  locationTypeToggleDisabled: boolean;
  trackTypeToggleDisabled: boolean;
  mediaTypeToggleDisabled: boolean;
  locationFiltersDisabled: boolean;
  trackFiltersDisabled: boolean;
  mediaFiltersDisabled: boolean;
  locationSectionDisabled: boolean;
  trackSectionDisabled: boolean;
  mediaSectionDisabled: boolean;
  onSetDateFilter: (key: 'from' | 'to', value: string) => void;
  onToggleLocationType: () => void;
  onToggleTrackType: () => void;
  onToggleMediaType: () => void;
  onSetLocationFilter: (key: 'venue_id' | 'category' | 'country', value: string) => void;
  onSetTrackFilter: (value: string) => void;
  onSetMediaFilter: (value: string) => void;
  onClearAll: () => void;
  /** Check-in plugin filter sections (rendered after the built-in types). */
  pluginFilterSpecs?: PluginFilterSpec[];
}

export default function Filters(props: FiltersProps) {
  const {
    hasActiveFilters,
    fromDate,
    toDate,
    category,
    country,
    trackActivity,
    includeLocation,
    includeTrack,
    includeMedia,
    mediaSubtypes,
    categoryOptions,
    countryOptions,
    trackActivityOptions,
    locationTypeToggleDisabled,
    trackTypeToggleDisabled,
    mediaTypeToggleDisabled,
    locationFiltersDisabled,
    trackFiltersDisabled,
    mediaFiltersDisabled,
    locationSectionDisabled,
    trackSectionDisabled,
    mediaSectionDisabled,
    onSetDateFilter,
    onToggleLocationType,
    onToggleTrackType,
    onToggleMediaType,
    onSetLocationFilter,
    onSetTrackFilter,
    onSetMediaFilter,
    onClearAll,
    pluginFilterSpecs = [],
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

        <MediaFilter
          included={includeMedia}
          filtersDisabled={mediaFiltersDisabled}
          sectionDisabled={mediaSectionDisabled}
          typeToggleDisabled={mediaTypeToggleDisabled}
          mediaSubtypes={mediaSubtypes}
          onToggleIncluded={onToggleMediaType}
          onSetMediaSubtypes={onSetMediaFilter}
        />

        {pluginFilterSpecs.map((spec) => (
          <div key={spec.plugin.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/40 dark:bg-gray-900/40 p-3">
            <PluginFilterSlot spec={spec} />
          </div>
        ))}
      </div>
    </div>
  );
}
