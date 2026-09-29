/**
 * Tracks filter section for the Home timeline.
 *
 * Adapted from the former core component (client/src/components/filters/TrackFilter.tsx)
 * to the plugin `PluginFilterSectionProps` contract, rendered inside the
 * shared `PluginFilterShell` so it matches the other plugin filter cards.
 * The distinct activity types are fetched lazily from the plugin's own
 * `/tracks/activity-types` endpoint instead of being passed in as props.
 */

import { useEffect, useMemo, useState } from 'react';
import { Route } from 'lucide-react';
import PluginFilterShell from '../../../client/src/components/filters/PluginFilterShell';
import type { PluginFilterSectionProps } from 'wwp-shared';
import { findExactOption } from '../../../client/src/components/filters/filterUtils';
import { tracks } from './api';

export function TrackFilter({
  included,
  filtersDisabled,
  sectionDisabled,
  typeToggleDisabled,
  params,
  onToggleIncluded,
  onSetParam,
}: PluginFilterSectionProps) {
  const trackActivity = params.track_activity ?? '';
  const [trackActivityInput, setTrackActivityInput] = useState(trackActivity);
  const [trackActivityOptions, setTrackActivityOptions] = useState<string[]>([]);

  useEffect(() => {
    setTrackActivityInput(trackActivity);
  }, [trackActivity]);

  useEffect(() => {
    let cancelled = false;
    tracks
      .activityTypes()
      .then((types) => {
        if (!cancelled) setTrackActivityOptions((types || []).sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTrackActivityOptions = useMemo(() => {
    const needle = trackActivityInput.trim().toLowerCase();
    if (!needle) return trackActivityOptions.slice(0, 30);
    return trackActivityOptions.filter((opt) => opt.toLowerCase().includes(needle)).slice(0, 30);
  }, [trackActivityInput, trackActivityOptions]);

  return (
    <PluginFilterShell
      icon={<Route size={16} className="text-rose-500" />}
      label="Tracks"
      included={included}
      filtersDisabled={filtersDisabled}
      sectionDisabled={sectionDisabled}
      typeToggleDisabled={typeToggleDisabled}
      onToggleIncluded={onToggleIncluded}
    >
      <div>
        <label className="text-xs text-gray-500 mb-1 block">Activity type</label>
        <input
          type="text"
          list="track-activity-options"
          value={trackActivityInput}
          disabled={sectionDisabled}
          onChange={(e) => {
            const next = e.target.value;
            setTrackActivityInput(next);
            const match = findExactOption(next, trackActivityOptions);
            if (match && trackActivity !== match) onSetParam('track_activity', match);
            if (!match && trackActivity) onSetParam('track_activity', '');
          }}
          onBlur={() => {
            if (!trackActivityInput.trim()) return;
            const match = findExactOption(trackActivityInput, trackActivityOptions);
            if (match) {
              setTrackActivityInput(match);
              if (trackActivity !== match) onSetParam('track_activity', match);
            } else {
              setTrackActivityInput('');
              if (trackActivity) onSetParam('track_activity', '');
            }
          }}
          className="input disabled:cursor-not-allowed disabled:opacity-60"
          placeholder="Cycling, Running..."
        />
        <datalist id="track-activity-options">
          {filteredTrackActivityOptions.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      </div>
    </PluginFilterShell>
  );
}
