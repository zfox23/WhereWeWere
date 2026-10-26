/**
 * Music plugin — client half.
 *
 * Most plays arrive from multi-scrobbler or an import, but a song heard out in
 * the world can be written down by hand (the check-in form). There is no detail
 * page: the timeline shows listening sessions, the Profile tab shows period
 * stats, a library and lists, and Settings holds the multi-scrobbler
 * connection and the history import.
 */

import type {
  CheckinTypeClientPlugin,
  CheckinCardProps,
  PluginProfileTabProps,
} from 'wwp-shared';
import { Music } from 'lucide-react';
import { manifest } from './manifest';
import { MusicCard } from './ui/MusicCard';
import { MusicTab } from './ui/MusicTab';
import { MusicSettings } from './ui/MusicSettings';
import MusicCheckInForm from './ui/MusicCheckInForm';

export const client: CheckinTypeClientPlugin = {
  icon: Music,
  iconColor: 'text-pink-500',
  fabOrder: 90,
  checkInPath: '/music-check-in',
  checkInForm: MusicCheckInForm,

  timelineCard: (props: CheckinCardProps) => <MusicCard {...props} />,
  profileTab: (props: PluginProfileTabProps) => <MusicTab {...props} />,

  settings: MusicSettings,
};

export { manifest };
