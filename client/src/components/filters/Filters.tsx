import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { X, ArrowLeftRight, ArrowRight, ArrowLeft } from 'lucide-react';
import type { CheckinTypeClient, PluginFilterSectionProps } from 'wwp-shared';
import PluginFilterShell from './PluginFilterShell';

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
    <PluginFilterShell
      icon={<Icon size={16} className={plugin.client.iconColor} />}
      label={plugin.strings.title}
      included={spec.included}
      filtersDisabled={spec.filtersDisabled}
      sectionDisabled={spec.sectionDisabled}
      typeToggleDisabled={spec.typeToggleDisabled}
      onToggleIncluded={spec.onToggleIncluded}
    >
      {!spec.sectionDisabled &&
        params.map((param) => {
          const field = plugin.fields.find((f) => f.name === param || (f.options && f.options.length > 0));
          const options = field?.options ?? [];
          return (
            <div key={param}>
              <select
                value={spec.params[param] ?? ''}
                disabled={spec.filtersDisabled}
                onChange={(e) => spec.onSetParam(param, e.target.value)}
                className="input"
              >
                <option value="">All {field?.label.toLowerCase() ?? param}s</option>
                {options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.icon ? `${opt.icon} ` : ''}{opt.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
    </PluginFilterShell>
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
  onSetDateFilter: (key: 'from' | 'to', value: string) => void;
  onClearAll: () => void;
  /** Check-in plugin filter sections (all check-in types are plugins). */
  pluginFilterSpecs?: PluginFilterSpec[];
  /** Invert the include state of every top-level plugin filter. */
  onInvertPluginFilters?: () => void;
}

export default function Filters(props: FiltersProps) {
  const {
    hasActiveFilters,
    fromDate,
    toDate,
    onSetDateFilter,
    onClearAll,
    pluginFilterSpecs = [],
    onInvertPluginFilters,
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

  const hasFrom = fromDateInput.length > 0;
  const hasTo = toDateInput.length > 0;
  const copyDirection: 'to-before' | 'to-after' | null =
    hasTo && !hasFrom ? 'to-after' : hasFrom && !hasTo ? 'to-before' : hasFrom && hasTo ? 'to-before' : null;

  const handleCopyDate = () => {
    if (!copyDirection) return;
    if (copyDirection === 'to-before') {
      setToDateInput(fromDateInput);
      if (COMPLETE_DATE_PATTERN.test(fromDateInput)) {
        onSetDateFilter('to', fromDateInput);
      }
    } else {
      setFromDateInput(toDateInput);
      if (COMPLETE_DATE_PATTERN.test(toDateInput)) {
        onSetDateFilter('from', toDateInput);
      }
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
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters</span>
          {onInvertPluginFilters && pluginFilterSpecs.length > 0 && (
            <button
              type="button"
              onClick={onInvertPluginFilters}
              className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <ArrowLeftRight size={12} />
              Invert
            </button>
          )}
        </div>
        {hasActiveFilters && (
          <button
            onClick={onClearAll}
            className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1"
          >
            <X size={12} />
            Reset
          </button>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
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
        <div className="flex items-end justify-center">
          <span className="mb-1 block h-4" />
          <button
            type="button"
            onClick={handleCopyDate}
            disabled={!copyDirection}
            title={
              copyDirection === 'to-before'
                ? 'Copy After date to Before'
                : copyDirection === 'to-after'
                  ? 'Copy Before date to After'
                  : 'Populate a date to enable copying'
            }
            aria-label={
              copyDirection === 'to-before'
                ? 'Copy After date to Before'
                : copyDirection === 'to-after'
                  ? 'Copy Before date to After'
                  : 'Copy date'
            }
            className="input flex items-center justify-center text-gray-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:text-primary-400 dark:hover:bg-primary-900/20 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:hover:bg-transparent cursor-default"
          >
            {copyDirection === 'to-after' ? <ArrowLeft size={16} /> : <ArrowRight size={16} />}
          </button>
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

      <div className="grid gap-3 lg:grid-cols-2">
        {pluginFilterSpecs.map((spec) => (
          <PluginFilterSlot key={spec.plugin.id} spec={spec} />
        ))}
      </div>
    </div>
  );
}
