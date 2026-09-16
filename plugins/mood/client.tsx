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
import MoodCheckInPage from '../../client/src/pages/MoodCheckIn';
import MoodCheckInDetail from '../../client/src/pages/MoodCheckInDetail';
import MoodCheckInCard from '../../client/src/components/MoodCheckInCard';
import MoodFilter from '../../client/src/components/filters/MoodFilter';
import { MoodsTab } from '../../client/src/components/MoodStats';
import { moodActivities, settings as settingsApi } from '../../client/src/api/client';
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

/** The legacy card reads iconPack from user settings. */
let iconPackCache: { at: number; value: string } | null = null;
function useMoodIconPack(): string {
  const [pack, setPack] = useState(iconPackCache?.value ?? 'emoji');
  useEffect(() => {
    if (iconPackCache && Date.now() - iconPackCache.at < 30_000) return;
    settingsApi
      .get()
      .then((s) => {
        const value = s?.mood_icon_pack || 'emoji';
        iconPackCache = { at: Date.now(), value };
        setPack(value);
      })
      .catch(() => {});
  }, []);
  return pack;
}

function MoodCard(props: CheckinCardProps) {
  // Home provides the user's icon pack, photos, and scrobbles via the card
  // contract; fall back to a settings lookup when rendered elsewhere.
  const fallbackPack = useMoodIconPack();
  return (
    <MoodCheckInCard
      item={toTimelineItem(props)}
      iconPack={props.iconPack || fallbackPack}
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
};

export { manifest };
