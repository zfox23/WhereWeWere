/**
 * Notes check-in type — client half.
 *
 * Custom storage: the plugin's own `/notes` API backs every UI here. Notes
 * are markdown with colored tags; Settings > Notes manages tags and imports
 * text files; Profile > Notes holds the stats, the similarity analysis and
 * the Note Library; the embedding endpoint lives in Settings > Integrations.
 */

import type {
  CheckinTypeClientPlugin,
  CheckinCardProps,
  CheckInFormProps,
  PluginFilterSectionProps,
  PluginProfileTabProps,
  PluginReflectionCardProps,
} from 'wwp-shared';
import { NotebookPen } from 'lucide-react';
import { manifest } from './manifest';
import NoteCheckIn from './ui/NoteCheckIn';
import NoteDetail from './ui/NoteDetail';
import { NoteCard } from './ui/NoteCard';
import { NoteFilter } from './ui/NoteFilter';
import { NoteReflectionCard } from './ui/NoteReflectionCard';
import { NotesTab } from './ui/NotesTab';
import { NotesSettings } from './ui/NotesSettings';
import { EmbeddingSettings } from './ui/EmbeddingSettings';

export const client: CheckinTypeClientPlugin = {
  icon: NotebookPen,
  iconColor: 'text-amber-500',
  hotkey: 'n',
  fabOrder: 40,
  checkInPath: '/note-check-in',
  detailPath: '/notes/:id',

  checkInForm: (props: CheckInFormProps) => <NoteCheckIn {...props} />,
  detailPage: () => <NoteDetail />,
  timelineCard: (props: CheckinCardProps) => <NoteCard {...props} />,
  filterSection: (props: PluginFilterSectionProps) => <NoteFilter {...props} />,
  reflectionCard: (props: PluginReflectionCardProps) => <NoteReflectionCard {...props} />,
  profileTab: (_props: PluginProfileTabProps) => <NotesTab />,

  settings: NotesSettings,
  integrationsSettings: EmbeddingSettings,
};

export { manifest };
