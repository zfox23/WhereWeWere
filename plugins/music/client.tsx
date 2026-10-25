/**
 * Music plugin — client half.
 *
 * Scrobbles are never created by hand (`noCheckIn`), so there is no check-in
 * form or detail page. The timeline shows listening sessions, the Profile tab
 * shows period stats and a library table, and Settings holds the
 * multi-scrobbler connection and the history import.
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

export const client: CheckinTypeClientPlugin = {
  icon: Music,
  iconColor: 'text-pink-500',
  fabOrder: 90,
  noCheckIn: true,
  // Unrouted: required by the contract, ignored while `noCheckIn` is set.
  checkInPath: '/music-check-in',

  timelineCard: (props: CheckinCardProps) => <MusicCard {...props} />,
  profileTab: (props: PluginProfileTabProps) => <MusicTab {...props} />,

  settings: MusicSettings,
};

export { manifest };
