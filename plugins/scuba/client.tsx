/**
 * SCUBA dive check-in type — client half.
 *
 * Ships custom UIs for every integration point: check-in page, detail page,
 * timeline card, Profile tab (dive stats), reflection card, and
 * Settings > SCUBA (Diving Log import). Storage is generic, so check-in
 * CRUD/timeline/backup come from the framework.
 */

import type {
  CheckinTypeClientPlugin,
  CheckinCardProps,
  CheckInDetailProps,
  CheckInFormProps,
  PluginProfileTabProps,
  PluginReflectionCardProps,
} from 'wwp-shared';
import { Waves } from 'lucide-react';
import { manifest } from './manifest';
import ScubaCheckInPage from './ui/ScubaCheckIn';
import ScubaDetailPage from './ui/ScubaDetail';
import { ScubaCard } from './ui/ScubaCard';
import { ScubaTab } from './ui/ScubaTab';
import { ScubaReflectionCard } from './ui/ScubaReflectionCard';
import { ScubaSettings } from './ui/ScubaSettings';

export const client: CheckinTypeClientPlugin = {
  icon: Waves,
  iconColor: 'text-cyan-600 dark:text-cyan-400',
  hotkey: 'd',
  fabOrder: 80,
  checkInPath: '/scuba-dive',
  // Detail page lives at the framework default /checkins/scuba/:id.
  detailPath: '/checkins/scuba/:id',

  checkInForm: (props: CheckInFormProps) => <ScubaCheckInPage {...props} />,
  detailPage: () => <ScubaDetailPage />,

  timelineCard: (props: CheckinCardProps) => <ScubaCard {...props} />,
  profileTab: (props: PluginProfileTabProps) => <ScubaTab {...props} />,
  reflectionCard: (props: PluginReflectionCardProps) => <ScubaReflectionCard {...props} />,

  settings: ScubaSettings,
};

export { manifest };
