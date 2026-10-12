import { MapPin } from 'lucide-react';
import type { PluginReflectionCardProps, ReflectionEntry } from 'wwp-shared';
import { ReflectionCard } from '../../../client/src/components/reflection/ReflectionCard';

/**
 * "This day in previous years" card for location check-ins. Location
 * reflection entries keep their venue columns at the top level (the server's
 * reflection branch fills them).
 */
export function LocationReflectionCard({ item }: PluginReflectionCardProps) {
  const it = item as ReflectionEntry;
  const detailHref = it.venue_id ? `/venues/${it.venue_id}` : `/location-checkins/${it.id}`;
  const timeHref = `/location-checkins/${it.id}`;

  const locationBits = [
    it.venue_category ?? null,
    it.city ? `${it.city}${it.country ? `, ${it.country}` : ''}` : null,
  ].filter(Boolean);

  return (
    <ReflectionCard
      to={detailHref}
      timeTo={timeHref}
      icon={<MapPin size={13} className="shrink-0 text-orange-500 dark:text-orange-400" />}
      title={it.venue_name || 'Unknown venue'}
      titleClassName="font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
      meta={locationBits.join(' · ')}
      note={it.note}
      checkedInAt={it.checked_in_at}
      timezone={it.venue_timezone}
    />
  );
}
