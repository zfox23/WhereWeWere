/**
 * Notes "this day in previous years" reflection card. The typed payload
 * arrives in `item.data` (built by the server's `reflectionBranch`).
 */

import { NotebookPen } from 'lucide-react';
import type { PluginReflectionCardProps } from 'wwp-shared';
import { pluginDetailPath } from '../../../client/src/plugins/registry';
import { ReflectionCard } from '../../../client/src/components/reflection/ReflectionCard';
import type { NoteTag } from './api';
import { TagChip } from './TagChip';

export function NoteReflectionCard({ item }: PluginReflectionCardProps) {
  const data = (item.data ?? {}) as { title?: string | null; tags?: NoteTag[]; checkin_timezone?: string | null };
  const tags = data.tags ?? [];
  return (
    <ReflectionCard
      to={pluginDetailPath(item.type, item.id)}
      icon={<NotebookPen size={13} className="text-amber-500" />}
      title={data.title || 'Note'}
      meta={tags.length > 0 ? <span className="inline-flex flex-wrap gap-1">{tags.map((t) => <TagChip key={t.id} tag={t} />)}</span> : undefined}
      note={item.note}
      checkedInAt={item.checked_in_at}
      timezone={data.checkin_timezone ?? null}
    />
  );
}
