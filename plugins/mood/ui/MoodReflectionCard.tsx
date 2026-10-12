/**
 * Mood "this day in previous years" reflection card.
 *
 * Rendered by the core ReflectTab's generic plugin `reflectionCard` slot for
 * reflection entries of type 'mood'. The typed payload arrives in `item.data`
 * (built by the server's `reflectionBranch`).
 */

import type { PluginReflectionCardProps } from 'wwp-shared';
import { MOOD_LABELS, MoodIcon } from './MoodIcons';
import { pluginDetailPath } from '../../../client/src/plugins/registry';
import { ReflectionCard } from '../../../client/src/components/reflection/ReflectionCard';

export function MoodReflectionCard({ item }: PluginReflectionCardProps) {
  const data = (item.data ?? {}) as Record<string, unknown>;
  const mood = typeof data.mood === 'number' ? data.mood : null;
  const moodTimezone = typeof data.mood_timezone === 'string' ? data.mood_timezone : null;
  const label =
    mood && mood >= 1 && mood <= 5 ? MOOD_LABELS[mood] : 'Mood check-in';
  const detailPath = pluginDetailPath(item.type, item.id);

  return (
    <ReflectionCard
      to={detailPath}
      icon={mood ? <MoodIcon mood={mood} pack="emoji" size={13} /> : undefined}
      title={label}
      note={item.note}
      checkedInAt={item.checked_in_at}
      timezone={moodTimezone}
    />
  );
}
