import { useEffect, useState } from 'react';
import { X, ArrowLeftRight } from 'lucide-react';
import type { CheckinTypeClient } from 'wwp-shared';
import PluginFilterShell from './PluginFilterShell';
import { DATE_PRESETS, matchDatePreset } from './datePresets';

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
  /** Called when the type's chip is clicked (Home decides the semantics). */
  onToggleIncluded: () => void;
  onSetParam: (name: string, value: string) => void;
}

const CHIP_BASE =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors';
const CHIP_ON =
  'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300';
const CHIP_OFF =
  'border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 hover:border-primary-400 dark:hover:border-primary-600';
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';

/**
 * Default refinements: one equality select per declared filter param, driven
 * by the matching field's options. Used when a plugin does not ship its own
 * `filterSection`.
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
          // Prefer the field named like the param. Only when none matches AND
          // exactly one field has options is that field an unambiguous stand-in.
          const withOptions = plugin.fields.filter((f) => f.options && f.options.length > 0);
          const field =
            plugin.fields.find((f) => f.name === param) ??
            (withOptions.length === 1 ? withOptions[0] : undefined);
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
 * Renders a plugin's refinements: the plugin's own `filterSection` when
 * provided, otherwise the default param controls.
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

/** A date input that commits on blur/Enter, and only complete dates. */
function DateInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [input, setInput] = useState(value);
  useEffect(() => setInput(value), [value]);

  const commit = () => {
    if (!input) {
      if (value) onCommit('');
      return;
    }
    if (COMPLETE_DATE_PATTERN.test(input)) {
      if (input !== value) onCommit(input);
      return;
    }
    setInput(value);
  };

  return (
    <label className="flex-1 min-w-36">
      <span className="text-xs text-gray-500 mb-1 block">{label}</span>
      <input
        type="date"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          if (!e.target.value && value) onCommit('');
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="input"
      />
    </label>
  );
}

function DateSection({
  fromDate,
  toDate,
  onSetDateRange,
}: {
  fromDate: string;
  toDate: string;
  onSetDateRange: (from: string, to: string) => void;
}) {
  const preset = matchDatePreset(fromDate, toDate);
  const hasDates = Boolean(fromDate || toDate);
  const [customOpen, setCustomOpen] = useState(false);
  const [singleDay, setSingleDay] = useState(Boolean(fromDate) && fromDate === toDate);
  const showCustom = customOpen || (hasDates && !preset);

  // Follow outside changes (e.g. clicking a day in the timeline sets from = to).
  useEffect(() => {
    if (fromDate && fromDate === toDate) setSingleDay(true);
  }, [fromDate, toDate]);

  // Clearing every date (Reset, removing pills) collapses the custom range.
  useEffect(() => {
    if (!hasDates) setCustomOpen(false);
  }, [hasDates]);

  const chip = (active: boolean) => `${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF}`;

  return (
    <section className="space-y-2">
      <h3 className={SECTION_LABEL}>When</h3>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={!hasDates && !showCustom}
          onClick={() => {
            setCustomOpen(false);
            if (hasDates) onSetDateRange('', '');
          }}
          className={chip(!hasDates && !showCustom)}
        >
          Any time
        </button>
        {DATE_PRESETS.map((p) => {
          const active = !showCustom && preset?.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCustomOpen(false);
                const r = p.range(new Date());
                onSetDateRange(r.from, r.to);
              }}
              className={chip(active)}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={showCustom}
          aria-expanded={showCustom}
          onClick={() => setCustomOpen(true)}
          className={chip(showCustom)}
        >
          Custom…
        </button>
      </div>

      {showCustom && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-3">
            {singleDay ? (
              <DateInput
                label="Day"
                value={fromDate === toDate ? fromDate : fromDate || toDate}
                onCommit={(v) => onSetDateRange(v, v)}
              />
            ) : (
              <>
                <DateInput label="From" value={fromDate} onCommit={(v) => onSetDateRange(v, toDate)} />
                <DateInput label="To" value={toDate} onCommit={(v) => onSetDateRange(fromDate, v)} />
              </>
            )}
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={singleDay}
              onChange={(e) => {
                const on = e.target.checked;
                setSingleDay(on);
                if (on) {
                  const day = fromDate || toDate;
                  if (day && (fromDate !== day || toDate !== day)) onSetDateRange(day, day);
                }
              }}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Single day
          </label>
        </div>
      )}
    </section>
  );
}

export interface FiltersProps {
  hasActiveFilters: boolean;
  fromDate: string;
  toDate: string;
  /** Set both ends of the date range at once ('' = open-ended). */
  onSetDateRange: (from: string, to: string) => void;
  onClearAll: () => void;
  /** Check-in plugin filter sections (all check-in types are plugins). */
  pluginFilterSpecs?: PluginFilterSpec[];
  /** Include every type again (and drop any type refinement). */
  onSelectAllTypes?: () => void;
  /** Invert the include state of every top-level plugin filter. */
  onInvertPluginFilters?: () => void;
  /** `sheet` drops the card chrome and adds a Done button (mobile bottom sheet). */
  variant?: 'inline' | 'sheet';
  /** Close handler for the sheet's Done button. */
  onDone?: () => void;
}

export default function Filters({
  hasActiveFilters,
  fromDate,
  toDate,
  onSetDateRange,
  onClearAll,
  pluginFilterSpecs = [],
  onSelectAllTypes,
  onInvertPluginFilters,
  variant = 'inline',
  onDone,
}: FiltersProps) {
  const included = pluginFilterSpecs.filter((s) => s.included);
  const allIncluded = included.length === pluginFilterSpecs.length;
  // A type's refinements show only while it is the single selected type: a
  // refinement narrows the timeline to its own type anyway.
  const focused = included.length === 1 ? included[0] : null;
  const refinementLocked = pluginFilterSpecs.some((s) => s.typeToggleDisabled);

  const chip = (active: boolean) => `${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF}`;

  const shell =
    variant === 'sheet'
      ? 'space-y-5'
      : 'bg-white/60 dark:bg-gray-900/60 rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/3 p-4 space-y-4';

  return (
    <div className={shell}>
      {pluginFilterSpecs.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className={SECTION_LABEL}>Show</h3>
            {allIncluded ? (
              <span className="text-xs text-gray-400 dark:text-gray-500">Pick one type to refine it</span>
            ) : (
              onInvertPluginFilters && !refinementLocked && (
                <button
                  type="button"
                  onClick={onInvertPluginFilters}
                  className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 flex items-center gap-1"
                >
                  <ArrowLeftRight size={12} />
                  Invert
                </button>
              )
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={allIncluded}
              onClick={() => onSelectAllTypes?.()}
              className={chip(allIncluded)}
            >
              All
            </button>
            {pluginFilterSpecs.map((spec) => {
              const Icon = spec.plugin.client.icon as React.ElementType<{ size?: number; className?: string }>;
              const active = !allIncluded && spec.included;
              return (
                <button
                  key={spec.plugin.id}
                  type="button"
                  aria-pressed={active}
                  onClick={spec.onToggleIncluded}
                  className={chip(active)}
                >
                  <Icon size={14} className={active || allIncluded ? spec.plugin.client.iconColor : 'text-gray-400'} />
                  {spec.plugin.strings.title}
                </button>
              );
            })}
          </div>
          {focused && (
            <div className="mt-1 rounded-xl bg-gray-50/80 dark:bg-gray-800/40 border border-gray-200/70 dark:border-gray-700/60 p-3 empty:hidden">
              <PluginFilterSlot spec={focused} />
            </div>
          )}
        </section>
      )}

      <DateSection fromDate={fromDate} toDate={toDate} onSetDateRange={onSetDateRange} />

      {(hasActiveFilters || onDone) && (
        <div className="flex items-center justify-between gap-3 pt-1">
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={onClearAll}
              className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 flex items-center gap-1"
            >
              <X size={12} />
              Reset all
            </button>
          ) : (
            <span />
          )}
          {onDone && (
            <button type="button" onClick={onDone} className="btn-primary px-5">
              Done
            </button>
          )}
        </div>
      )}
    </div>
  );
}
