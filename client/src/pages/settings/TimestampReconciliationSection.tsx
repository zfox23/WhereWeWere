import { useState } from 'react';
import { Clock, Loader2, Check, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { settings } from '../../api/client';
import type {
  TimestampReconciliationSuggestion,
  TimestampReconciliationUninferableMoodCheckin,
  TimestampReconciliationUpdate,
} from '../../types';

function formatOriginalTimestamp(dateStr: string, timeZone: string | null): string {
  const date = new Date(dateStr);
  if (!timeZone) {
    return `${new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(date)} (stored without timezone)`;
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(date);
}

interface TimestampSuggestionTimezoneGroup {
  key: string;
  label: string;
  suggestions: TimestampReconciliationSuggestion[];
}

interface TimestampSuggestionTypeGroup {
  key: 'venue' | 'mood';
  label: string;
  suggestions: TimestampReconciliationSuggestion[];
  timezoneGroups: TimestampSuggestionTimezoneGroup[];
}

function buildTimestampSuggestionGroups(suggestions: TimestampReconciliationSuggestion[]): TimestampSuggestionTypeGroup[] {
  return (['venue', 'mood'] as const)
    .map((type) => {
      const typeSuggestions = suggestions.filter((suggestion) => suggestion.type === type);
      const timezoneMap = new Map<string, TimestampReconciliationSuggestion[]>();

      for (const suggestion of typeSuggestions) {
        const label = suggestion.original_timezone || 'Missing';
        const existing = timezoneMap.get(label) || [];
        existing.push(suggestion);
        timezoneMap.set(label, existing);
      }

      const timezoneGroups = Array.from(timezoneMap.entries())
        .sort(([left], [right]) => {
          if (left === 'Missing') return -1;
          if (right === 'Missing') return 1;
          return left.localeCompare(right);
        })
        .map(([label, groupSuggestions]) => ({
          key: `${type}:${label}`,
          label,
          suggestions: groupSuggestions,
        }));

      return {
        key: type,
        label: type === 'venue' ? 'Venue Checkins' : 'Mood Checkins',
        suggestions: typeSuggestions,
        timezoneGroups,
      };
    });
}

export function TimestampReconciliationSection() {
  const [suggestions, setSuggestions] = useState<TimestampReconciliationSuggestion[]>([]);
  const [uninferableMoodCheckins, setUninferableMoodCheckins] = useState<TimestampReconciliationUninferableMoodCheckin[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [collapsedTypeGroups, setCollapsedTypeGroups] = useState<Set<string>>(new Set());
  const [collapsedTimezoneGroups, setCollapsedTimezoneGroups] = useState<Set<string>>(new Set());
  const [isUninferableGroupCollapsed, setIsUninferableGroupCollapsed] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const allSelected = suggestions.length > 0 && selectedKeys.size === suggestions.length;
  const groupedSuggestions = buildTimestampSuggestionGroups(suggestions);

  const keyForSuggestion = (suggestion: Pick<TimestampReconciliationSuggestion, 'id' | 'type'>) => `${suggestion.type}:${suggestion.id}`;

  const areSuggestionsSelected = (items: TimestampReconciliationSuggestion[]) => items.length > 0 && items.every((item) => selectedKeys.has(keyForSuggestion(item)));

  const toggleSuggestionBatch = (items: TimestampReconciliationSuggestion[]) => {
    const shouldSelect = !areSuggestionsSelected(items);
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      for (const item of items) {
        const key = keyForSuggestion(item);
        if (shouldSelect) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }
      return next;
    });
  };

  const toggleCollapsed = (key: string, setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const loadSuggestions = async (options?: { preserveMessage?: boolean }) => {
    setLoading(true);
    if (!options?.preserveMessage) {
      setMessage(null);
    }
    try {
      const data = await settings.timestampReconciliationPreview();
      const nextSuggestions = data.suggestions as TimestampReconciliationSuggestion[];
      const nextUninferableMoodCheckins = data.uninferable_mood_checkins as TimestampReconciliationUninferableMoodCheckin[];
      setSuggestions(nextSuggestions);
      setUninferableMoodCheckins(nextUninferableMoodCheckins);
      setSelectedKeys(new Set(nextSuggestions.map((suggestion) => keyForSuggestion(suggestion))));
      setCollapsedTypeGroups(new Set());
      setCollapsedTimezoneGroups(new Set());
      setIsUninferableGroupCollapsed(false);
      setHasScanned(true);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to scan timestamp suggestions.' });
    } finally {
      setLoading(false);
    }
  };

  const toggleSuggestion = (suggestion: Pick<TimestampReconciliationSuggestion, 'id' | 'type'>) => {
    const key = keyForSuggestion(suggestion);
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedKeys(allSelected ? new Set() : new Set(suggestions.map((suggestion) => keyForSuggestion(suggestion))));
  };

  const handleApply = async () => {
    const updates: TimestampReconciliationUpdate[] = suggestions
      .filter((suggestion) => selectedKeys.has(keyForSuggestion(suggestion)))
      .map((suggestion) => ({
        id: suggestion.id,
        type: suggestion.type,
        suggested_timezone: suggestion.suggested_timezone,
      }));

    if (updates.length === 0) return;

    setApplying(true);
    setMessage(null);
    try {
      const result = await settings.applyTimestampReconciliation(updates);
      await loadSuggestions({ preserveMessage: true });
      setMessage({ type: 'success', text: `Updated ${result.updated} timestamp${result.updated === 1 ? '' : 's'}.` });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update timestamps.' });
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="bg-white/60 dark:bg-gray-900/60 backdrop-blur-xl rounded-2xl border border-white/40 dark:border-gray-700/40 shadow-sm shadow-black/[0.03] p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Clock size={20} className="text-gray-600 dark:text-gray-400" />
            Timestamp Reconciliation
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Maintenance tool for legacy timezone mismatches. Mood suggestions use the nearest venue check-in within 24 hours.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void loadSuggestions(); }}
          disabled={loading || applying}
          className="btn-secondary"
        >
          {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : <Clock size={16} className="mr-2" />}
          Scan Timestamps
        </button>
      </div>

      {message && (
        <div className={`flex items-center gap-2 text-sm ${message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600'}`}>
          {message.type === 'success' ? <Check size={16} /> : <AlertCircle size={16} />}
          {message.text}
        </div>
      )}

      {(suggestions.length > 0 || uninferableMoodCheckins.length > 0) && (
        <>
          {suggestions.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                {allSelected ? 'Clear selection' : 'Select all'}
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {selectedKeys.size} of {suggestions.length} selected
              </p>
            </div>
          )}

          <div className="space-y-3">
            {groupedSuggestions.map((typeGroup) => {
              const typeCollapsed = collapsedTypeGroups.has(typeGroup.key);
              const typeSelected = areSuggestionsSelected(typeGroup.suggestions);
              const isTypeEmpty = typeGroup.suggestions.length === 0;

              return (
                <div key={typeGroup.key} className="rounded-xl border border-gray-200/70 dark:border-gray-800 overflow-hidden">
                  <div className="flex items-center justify-between gap-3 bg-gray-50/80 dark:bg-gray-800/70 px-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={typeSelected}
                        disabled={isTypeEmpty}
                        onChange={() => toggleSuggestionBatch(typeGroup.suggestions)}
                        aria-label={`Select all ${typeGroup.label}`}
                      />
                      <button
                        type="button"
                        onClick={() => toggleCollapsed(typeGroup.key, setCollapsedTypeGroups)}
                        className="inline-flex items-center gap-2 text-left min-w-0"
                      >
                        {typeCollapsed ? <ChevronRight size={16} className="shrink-0 text-gray-500" /> : <ChevronDown size={16} className="shrink-0 text-gray-500" />}
                        <span className="font-medium text-gray-900 dark:text-gray-100">{typeGroup.label}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{typeGroup.suggestions.length}</span>
                      </button>
                    </div>
                    {!isTypeEmpty && (
                      <button
                        type="button"
                        onClick={() => toggleSuggestionBatch(typeGroup.suggestions)}
                        className="text-xs font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
                      >
                        {typeSelected ? 'Clear group' : 'Select group'}
                      </button>
                    )}
                  </div>

                  {!typeCollapsed && (
                    <div className="bg-white/50 dark:bg-gray-900/40 p-3 space-y-3">
                      {isTypeEmpty && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 px-1 py-1">
                          All {typeGroup.label} appear correct. No reconciliation changes are suggested.
                        </p>
                      )}

                      {typeGroup.timezoneGroups.map((timezoneGroup) => {
                        const timezoneCollapsed = collapsedTimezoneGroups.has(timezoneGroup.key);
                        const timezoneSelected = areSuggestionsSelected(timezoneGroup.suggestions);

                        return (
                          <div key={timezoneGroup.key} className="rounded-lg border border-gray-200/70 dark:border-gray-800 overflow-hidden">
                            <div className="flex items-center justify-between gap-3 bg-white/70 dark:bg-gray-900/70 px-3 py-2.5">
                              <div className="flex items-center gap-3 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={timezoneSelected}
                                  onChange={() => toggleSuggestionBatch(timezoneGroup.suggestions)}
                                  aria-label={`Select all ${timezoneGroup.label} suggestions`}
                                />
                                <button
                                  type="button"
                                  onClick={() => toggleCollapsed(timezoneGroup.key, setCollapsedTimezoneGroups)}
                                  className="inline-flex items-center gap-2 text-left min-w-0"
                                >
                                  {timezoneCollapsed ? <ChevronRight size={15} className="shrink-0 text-gray-500" /> : <ChevronDown size={15} className="shrink-0 text-gray-500" />}
                                  <span className="font-medium text-gray-800 dark:text-gray-200">Original timezone: {timezoneGroup.label}</span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400">{timezoneGroup.suggestions.length}</span>
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleSuggestionBatch(timezoneGroup.suggestions)}
                                className="text-xs font-medium text-primary-600 hover:text-primary-700 whitespace-nowrap"
                              >
                                {timezoneSelected ? 'Clear subgroup' : 'Select subgroup'}
                              </button>
                            </div>

                            {!timezoneCollapsed && (
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-gray-50/80 dark:bg-gray-800/80 text-left text-gray-600 dark:text-gray-300">
                                    <tr>
                                      <th className="px-3 py-2.5 w-10"></th>
                                      <th className="px-3 py-2.5 font-medium">Original timestamp</th>
                                      <th className="px-3 py-2.5 font-medium">Original timezone</th>
                                      <th className="px-3 py-2.5 font-medium">Suggested timezone</th>
                                      <th className="px-3 py-2.5 font-medium">Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white/40 dark:bg-gray-900/30">
                                    {timezoneGroup.suggestions.map((suggestion) => {
                                      const rowKey = keyForSuggestion(suggestion);
                                      return (
                                        <tr key={rowKey} className="align-top">
                                          <td className="px-3 py-3">
                                            <input
                                              type="checkbox"
                                              checked={selectedKeys.has(rowKey)}
                                              onChange={() => toggleSuggestion(suggestion)}
                                              aria-label={`Select ${suggestion.type} timestamp suggestion`}
                                            />
                                          </td>
                                          <td className="px-3 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                                            <a
                                              href={suggestion.detail_path}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="font-medium text-primary-700 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300"
                                            >
                                              {formatOriginalTimestamp(suggestion.original_timestamp, suggestion.original_timezone)}
                                            </a>
                                          </td>
                                          <td className="px-3 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                            {suggestion.original_timezone || 'Missing'}
                                          </td>
                                          <td className="px-3 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                                            {suggestion.suggested_timezone}
                                          </td>
                                          <td className="px-3 py-3 text-gray-600 dark:text-gray-300 min-w-[18rem]">
                                            {suggestion.reason}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {uninferableMoodCheckins.length > 0 && (
              <div className="rounded-xl border border-amber-200/80 dark:border-amber-900/50 overflow-hidden">
                <div className="flex items-center justify-between gap-3 bg-amber-50/70 dark:bg-amber-900/20 px-3 py-3">
                  <button
                    type="button"
                    onClick={() => setIsUninferableGroupCollapsed((previous) => !previous)}
                    className="inline-flex items-center gap-2 text-left min-w-0"
                  >
                    {isUninferableGroupCollapsed ? <ChevronRight size={16} className="shrink-0 text-amber-700 dark:text-amber-400" /> : <ChevronDown size={16} className="shrink-0 text-amber-700 dark:text-amber-400" />}
                    <span className="font-medium text-amber-800 dark:text-amber-300">Mood Checkins (Cannot Infer Timezone)</span>
                    <span className="text-xs text-amber-700/80 dark:text-amber-400/80">{uninferableMoodCheckins.length}</span>
                  </button>
                </div>

                {!isUninferableGroupCollapsed && (
                  <div className="overflow-x-auto bg-white/50 dark:bg-gray-900/40">
                    <table className="min-w-full text-sm">
                      <thead className="bg-amber-50/80 dark:bg-amber-900/20 text-left text-amber-900 dark:text-amber-300">
                        <tr>
                          <th className="px-3 py-2.5 font-medium">Original timestamp</th>
                          <th className="px-3 py-2.5 font-medium">Original timezone</th>
                          <th className="px-3 py-2.5 font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white/40 dark:bg-gray-900/30">
                        {uninferableMoodCheckins.map((checkin) => (
                          <tr key={checkin.id} className="align-top">
                            <td className="px-3 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                              <a
                                href={checkin.detail_path}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-primary-700 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300"
                              >
                                {formatOriginalTimestamp(checkin.original_timestamp, checkin.original_timezone)}
                              </a>
                            </td>
                            <td className="px-3 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                              {checkin.original_timezone || 'Missing'}
                            </td>
                            <td className="px-3 py-3 text-gray-600 dark:text-gray-300 min-w-[20rem]">
                              {checkin.reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {suggestions.length > 0 && (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={handleApply}
                disabled={applying || selectedKeys.size === 0}
                className="btn-primary"
              >
                {applying ? <Loader2 size={16} className="animate-spin mr-2" /> : <Check size={16} className="mr-2" />}
                Update Timestamps
              </button>
            </div>
          )}
        </>
      )}

      {!loading && suggestions.length === 0 && !hasScanned && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Run a scan to find venue and mood check-ins whose stored timezone should be updated.
        </p>
      )}

      {!loading && suggestions.length === 0 && uninferableMoodCheckins.length === 0 && hasScanned && !message?.text && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No timezone changes were suggested for your current venue and mood check-ins.
        </p>
      )}
    </div>
  );
}
