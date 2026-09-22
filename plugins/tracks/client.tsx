/**
 * Tracks check-in type — client half.
 *
 * Ships full custom UIs for every integration point: check-in (upload) page,
 * detail page (map + graph + stats), timeline card, Home filter section, and
 * the Profile tab. The components under `ui/` were adapted from the former
 * core components (pages/TrackCheckIn, pages/TrackDetail,
 * components/TrackCard, components/TrackGraph, components/TracksTab,
 * filters/TrackFilter) to the plugin prop contracts.
 */

import type {
  CheckinTypeClientPlugin,
  CheckinCardProps,
  CheckInDetailProps,
  CheckInFormProps,
  PluginFilterSectionProps,
  PluginProfileTabProps,
  PluginReflectionCardProps,
} from 'wwp-shared';
import { Route } from 'lucide-react';
import { manifest } from './manifest';
import TrackCheckInPage from './ui/TrackCheckIn';
import TrackDetailPage from './ui/TrackDetail';
import { TrackCard } from './ui/TrackCard';
import { TrackFilter } from './ui/TrackFilter';
import { TracksTab } from './ui/TracksTab';
import { TrackReflectionCard } from './ui/TrackReflectionCard';

export const client: CheckinTypeClientPlugin = {
  icon: Route,
  iconColor: 'text-rose-500',
  hotkey: 't',
  fabOrder: 100,
  checkInPath: '/track-check-in',
  detailPath: '/tracks/:id',

  checkInForm: (props: CheckInFormProps) => <TrackCheckInPage {...props} />,
  detailPage: (props: CheckInDetailProps) => <TrackDetailPage {...props} />,

  timelineCard: (props: CheckinCardProps) => <TrackCard {...props} />,
  filterSection: (props: PluginFilterSectionProps) => <TrackFilter {...props} />,
  profileTab: (props: PluginProfileTabProps) => <TracksTab {...props} />,
  reflectionCard: (props: PluginReflectionCardProps) => <TrackReflectionCard {...props} />,
};

export { manifest };
