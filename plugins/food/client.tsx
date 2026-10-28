/**
 * Food check-in type — client half.
 *
 * Custom storage: the plugin's own `/food` API backs every UI here. Meals
 * come from the Mealie recipe library or free text; Profile > Food hosts the
 * LLM meal suggestions; Settings > Food holds the Mealie connection.
 */

import type {
  CheckinTypeClientPlugin,
  CheckinCardProps,
  CheckInFormProps,
  PluginProfileTabProps,
} from 'wwp-shared';
import { UtensilsCrossed } from 'lucide-react';
import { manifest } from './manifest';
import FoodCheckIn from './ui/FoodCheckIn';
import FoodDetail from './ui/FoodDetail';
import { FoodCard } from './ui/FoodCard';
import { FoodTab } from './ui/FoodTab';
import { FoodSettings } from './ui/FoodSettings';

export const client: CheckinTypeClientPlugin = {
  icon: UtensilsCrossed,
  iconColor: 'text-orange-500',
  hotkey: 'f',
  fabOrder: 35,
  checkInPath: '/food-check-in',
  detailPath: '/food-checkins/:id',

  checkInForm: (props: CheckInFormProps) => <FoodCheckIn {...props} />,
  detailPage: () => <FoodDetail />,
  timelineCard: (props: CheckinCardProps) => <FoodCard {...props} />,
  profileTab: (_props: PluginProfileTabProps) => <FoodTab />,

  settings: FoodSettings,
};

export { manifest };
