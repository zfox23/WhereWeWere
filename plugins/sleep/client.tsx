/**
 * Sleep check-in type — client half.
 *
 * Ships full custom UIs for every integration point: check-in page, detail
 * page, timeline card, Home filter section, Profile tab, reflection card,
 * Settings > Sleep (webhook URL) and Settings > Data (CSV import).
 * The components under `ui/` were adapted from the former core components
 * (pages/SleepCheckIn, pages/SleepDetail, components/SleepCard,
 * components/SleepTab, filters/SleepFilter, settings sections) to the
 * plugin prop contracts.
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
import { Moon } from 'lucide-react';
import { manifest } from './manifest';
import SleepCheckInPage from './ui/SleepCheckIn';
import SleepDetailPage from './ui/SleepDetail';
import { SleepCard } from './ui/SleepCard';
import { SleepFilter } from './ui/SleepFilter';
import { SleepTab } from './ui/SleepStats';
import { SleepReflectionCard } from './ui/SleepReflectionCard';
import { SleepSettings } from './ui/SleepSettings';

export const client: CheckinTypeClientPlugin = {
  icon: Moon,
  iconColor: 'text-indigo-500',
  hotkey: 's',
  fabOrder: 100,
  checkInPath: '/sleep-check-in',
  detailPath: '/sleep-entries/:id',

  checkInForm: (props: CheckInFormProps) => <SleepCheckInPage {...props} />,
  detailPage: (props: CheckInDetailProps) => <SleepDetailPage {...props} />,

  timelineCard: (props: CheckinCardProps) => <SleepCard {...props} />,
  filterSection: (props: PluginFilterSectionProps) => <SleepFilter {...props} />,
  profileTab: (props: PluginProfileTabProps) => <SleepTab {...props} />,
  reflectionCard: (props: PluginReflectionCardProps) => <SleepReflectionCard {...props} />,

  settings: SleepSettings,
};

export { manifest };
