/**
 * Media "this day in previous years" reflection card.
 *
 * Rendered by the core ReflectTab's generic plugin `reflectionCard` slot for
 * reflection entries of type 'media'. The typed payload arrives in `item.data`
 * (built by the server's `reflectionBranch`).
 */

import { Clapperboard } from 'lucide-react';
import type { PluginReflectionCardProps } from 'wwp-shared';
import type { MediaSubtype } from '../../../client/src/types';
import { slugify } from '../../../client/src/utils/slugify';
import { MEDIA_SUBTYPES, CHECKIN_TYPE_LABELS, detailPath } from '../utils/media';
import { ReflectionCard } from '../../../client/src/components/reflection/ReflectionCard';

interface MediaReflectionData {
  media_type?: string | null;
  media_item_id?: string | null;
  media_title?: string | null;
  rating?: number | null;
  checkin_type?: string | null;
  season_number?: number | null;
  episode_number?: number | null;
  episode_title?: string | null;
  checkin_timezone?: string | null;
}

export function MediaReflectionCard({ item }: PluginReflectionCardProps) {
  const data = (item.data ?? {}) as MediaReflectionData;
  const subtype = MEDIA_SUBTYPES[data.media_type as MediaSubtype];
  const title = data.media_title || 'Media check-in';
  const checkinLabel = data.checkin_type ? CHECKIN_TYPE_LABELS[data.checkin_type] : null;

  let episodeSuffix: string | null = null;
  if (data.season_number != null && data.episode_number != null) {
    const epTitle = data.episode_title ? ` "${data.episode_title}"` : '';
    episodeSuffix = `S${data.season_number}:E${data.episode_number}${epTitle}`;
  }

  const detail =
    subtype && data.media_item_id
      ? detailPath(subtype.subtype, data.media_item_id, slugify(title))
      : null;

  return (
    <ReflectionCard
      to={detail}
      icon={<Clapperboard size={13} className="shrink-0 text-violet-600 dark:text-violet-400" />}
      title={title}
      meta={[checkinLabel, episodeSuffix].filter(Boolean).join(' · ')}
      note={item.note}
      checkedInAt={item.checked_in_at}
      timezone={data.checkin_timezone}
    />
  );
}
