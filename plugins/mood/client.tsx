/**
 * Mood check-in type — client half.
 *
 * Ships full custom UIs for every integration point: check-in page, detail
 * page, timeline card, Home filter section, and Profile tab. The existing
 * components (pages/MoodCheckIn, MoodCheckInDetail, MoodCheckInCard,
 * filters/MoodFilter, MoodsTab) are adapted to the plugin prop contracts.
 */

import { useEffect, useState } from 'react';
import type {
  CheckinTypeClientPlugin,
  CheckinCardProps,
  CheckInDetailProps,
  CheckInFormProps,
  PluginFilterSectionProps,
  PluginProfileTabProps,
} from 'wwp-shared';
import { Smile } from 'lucide-react';
import { manifest } from './manifest';
import MoodCheckInPage from './ui/MoodCheckIn';
import MoodCheckInDetail from './ui/MoodCheckInDetail';
import MoodCheckInCard from './ui/MoodCheckInCard';
import MoodFilter from './ui/MoodFilter';
import { MoodsTab } from './ui/MoodStats';
import { DaylioImportSection } from './ui/DaylioImportSection';
import { MoodTab } from './ui/MoodTab';
import { moodActivities } from './ui/api';
import { plugins } from '../../client/src/plugins/api';
import type { TimelineItem } from '../../client/src/types';

/** MoodCheckInCard expects the legacy TimelineItem shape. */
function toTimelineItem(props: CheckinCardProps): TimelineItem {
  const data = (props.item.data ?? {}) as Record<string, any>;
  return {
    type: 'mood',
    id: props.item.id,
    user_id: props.item.user_id,
    checked_in_at: props.item.checked_in_at,
    created_at: props.item.created_at,
    notes: props.item.notes,
    mood: typeof data.mood === 'number' ? data.mood : undefined,
    mood_timezone: props.item.timezone,
    activities: Array.isArray(data.activities) ? data.activities : null,
  } as TimelineItem;
}

/**
 * The mood icon pack lives in this plugin's `plugin_settings` (key
 * `mood_icon_pack`). The card contract passes the effective settings via
 * `props.settings`; when rendered outside a context that provides them we
 * fetch the plugin settings directly.
 */
function MoodCard(props: CheckinCardProps) {
  const packFromProps = typeof props.settings?.mood_icon_pack === 'string' ? props.settings.mood_icon_pack : null;
  const [fetchedPack, setFetchedPack] = useState<string | null>(null);

  useEffect(() => {
    if (packFromProps) return;
    plugins.settings
      .get('mood')
      .then((s) => {
        const value = typeof s?.mood_icon_pack === 'string' ? s.mood_icon_pack : null;
        if (value) setFetchedPack(value);
      })
      .catch(() => {});
  }, [packFromProps]);

  return (
    <MoodCheckInCard
      item={toTimelineItem(props)}
      iconPack={packFromProps || fetchedPack || 'emoji'}
      immichUrl={props.integrations.immich_url ?? null}
      photos={(props.photos as unknown as import('../../client/src/types').ImmichAsset[]) ?? null}
      scrobbles={(props.scrobbles as unknown as import('../../client/src/types').Scrobble[]) ?? []}
      malojaUrl={props.integrations.maloja_url ?? null}
      compact={props.compact}
    />
  );
}

function MoodFilterSection(props: PluginFilterSectionProps) {
  const [activityOptions, setActivityOptions] = useState<{ id: string; name: string; groupName: string }[]>([]);

  useEffect(() => {
    moodActivities
      .groups()
      .then((groups) => {
        const options = (groups || []).flatMap((g: any) =>
          (g.activities || []).map((a: any) => ({
            id: a.id,
            name: a.name,
            groupName: g.name,
          })),
        );
        options.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
        setActivityOptions(options);
      })
      .catch(() => setActivityOptions([]));
  }, []);

  return (
    <MoodFilter
      included={props.included}
      filtersDisabled={props.filtersDisabled}
      sectionDisabled={props.sectionDisabled}
      typeToggleDisabled={props.typeToggleDisabled}
      mood={props.params.mood ?? ''}
      activity={props.params.activity ?? ''}
      activityOptions={activityOptions}
      onToggleIncluded={props.onToggleIncluded}
      onSetMood={(value) => props.onSetParam('mood', value)}
      onSetActivity={(value) => props.onSetParam('activity', value)}
    />
  );
}

function MoodProfileTab(_props: PluginProfileTabProps) {
  return <MoodsTab />;
}

export const client: CheckinTypeClientPlugin = {
  icon: Smile,
  iconColor: 'text-green-500',
  hotkey: 'm',
  fabOrder: 100,
  checkInPath: '/mood-check-in',
  detailPath: '/mood-checkins/:id',

  // MoodCheckInPage / MoodCheckInDetail are self-contained (they read their
  // own route params), so the wrappers just render them.
  checkInForm: () => <MoodCheckInPage />,
  detailPage: (_props: CheckInDetailProps) => <MoodCheckInDetail />,

  timelineCard: MoodCard,
  filterSection: MoodFilterSection,
  profileTab: MoodProfileTab,
  dataSettings: DaylioImportSection,
  settings: MoodTab,
};

export { manifest };
