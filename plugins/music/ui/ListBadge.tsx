import { Heart } from 'lucide-react';
import { useMusicLists } from './useMusicLists';

/** A small heart for a song or album that is on at least one list. */
export function ListBadge({ itemKey, size = 12 }: { itemKey: string | null | undefined; size?: number }) {
  const { has, count } = useMusicLists();
  if (!itemKey || !has(itemKey)) return null;
  const n = count(itemKey);
  return (
    <span title={`On ${n} list${n === 1 ? '' : 's'}`} aria-label={`On ${n} list${n === 1 ? '' : 's'}`} className="ml-1 inline-flex shrink-0 align-middle text-pink-500">
      <Heart size={size} fill="currentColor" />
    </span>
  );
}

export const songItemKey = (songKey: string | null | undefined) => (songKey ? `song:${songKey}` : null);
export const albumItemKey = (albumRef: string | null | undefined) => (albumRef != null ? `album:${albumRef}` : null);
