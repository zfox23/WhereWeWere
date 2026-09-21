/**
 * Media check-in type — client half.
 *
 * Media is a custom-storage plugin: check-ins live in `media_checkins` and
 * the timeline carries the legacy `media_*` columns on the shared envelope,
 * so the existing MediaCard renders straight from the timeline row (no
 * `data` object to unpack). The check-in flow is a multi-step search-first
 * experience (search for the item, then create the check-in against it)
 * with per-subtype routes, so the app's router registers the plugin's page
 * components directly — see `checkInForm`/`detailPage` notes below.
 */

import type {
  CheckinTypeClientPlugin,
  CheckinCardProps,
  CheckInFormProps,
  PluginFilterSectionProps,
  PluginProfileTabProps,
} from 'wwp-shared';
import { Clapperboard } from 'lucide-react';
import { manifest } from './manifest';
import MediaCheckInLanding from './ui/pages/MediaCheckInLanding';
import MediaCard from './ui/MediaCard';
import MediaFilter from './ui/MediaFilter';
import { MediaTab } from './ui/MediaTab';
import { MediaIntegrationsSettings } from './ui/MediaIntegrationsSettings';
import { YamtrackImportSection } from './ui/YamtrackImportSection';
import type { TimelineItem } from '../../client/src/types';

/**
 * Timeline card adapter. The media branch of the unified timeline emits the
 * legacy `media_*` columns on the envelope row, which is exactly the shape
 * the pre-plugin MediaCard consumed as a `TimelineItem`.
 */
function MediaCardAdapter(props: CheckinCardProps) {
  return <MediaCard item={props.item as unknown as TimelineItem} compact={props.compact} />;
}

function MediaFilterSection(props: PluginFilterSectionProps) {
  return (
    <MediaFilter
      included={props.included}
      filtersDisabled={props.filtersDisabled}
      sectionDisabled={props.sectionDisabled}
      typeToggleDisabled={props.typeToggleDisabled}
      mediaSubtypes={props.params.media_subtype ?? ''}
      onToggleIncluded={props.onToggleIncluded}
      onSetMediaSubtypes={(value) => props.onSetParam('media_subtype', value)}
    />
  );
}

function MediaProfileTab(_props: PluginProfileTabProps) {
  return <MediaTab />;
}

/**
 * Check-in landing page. The media check-in flow is search-first with
 * per-subtype routes (`/media-check-in/movie/:id/:slug`, ...), which the app
 * router registers directly from this plugin's page components; the
 * framework's `checkInPath` route renders the landing page.
 */
function MediaCheckInPage(_props: CheckInFormProps) {
  return <MediaCheckInLanding />;
}

export const client: CheckinTypeClientPlugin = {
  icon: Clapperboard,
  iconColor: 'text-violet-500',
  hotkey: 'n',
  fabOrder: 100,
  checkInPath: '/media-check-in',
  // No `detailPath`/`detailPage`: media detail URLs are item-scoped
  // (`/media/<segment>/<itemId>/<slug>`) and are reached from the timeline
  // card, the Profile tab, and the media library rather than by check-in id.
  checkInForm: MediaCheckInPage,

  timelineCard: MediaCardAdapter,
  filterSection: MediaFilterSection,
  profileTab: MediaProfileTab,

  integrationsSettings: MediaIntegrationsSettings,
  dataSettings: YamtrackImportSection,
};

export { manifest };
