/**
 * Music's "Rank by comparing": the shared tool (client/src/components/lists/
 * RankByComparing.tsx) with a song/album card for each contender.
 */

import { RankByComparing as SharedRankByComparing } from '../../../client/src/components/lists/RankByComparing';
import type { Contender } from '../../../client/src/components/lists/RankByComparing';
import { albumArtUrl, music } from './api';
import { joinArtists } from './format';
import type { ListItemWithStats, MusicList } from './types';

const getId = (i: ListItemWithStats) => i.id;
const getRank = (i: ListItemWithStats) => i.rank;

export const renderContender = (item: ListItemWithStats): Contender => ({
  media: item.art_id ? <img src={albumArtUrl(item.art_id, 'large')} alt="" className="aspect-square w-full object-cover" /> : undefined,
  badge: (
    <span className="rounded-full bg-pink-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-pink-600 dark:bg-pink-900/30 dark:text-pink-300">
      {item.kind}
    </span>
  ),
  body: (
    <>
      <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{item.title}</p>
      <p className="text-sm text-gray-600 dark:text-gray-300">{joinArtists(item.artists)}</p>
      {item.kind === 'song' && item.album && <p className="text-xs text-gray-500 dark:text-gray-400">{item.album}</p>}
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {item.plays.toLocaleString()} play{item.plays === 1 ? '' : 's'}
      </p>
    </>
  ),
});

export function RankByComparing({
  list,
  items,
  onDone,
}: {
  list: MusicList;
  items: ListItemWithStats[];
  /** Leave the tool; `applied` says whether the list's ranks were changed. */
  onDone: (applied: boolean) => void;
}) {
  return (
    <SharedRankByComparing
      list={list}
      items={items}
      api={music}
      getId={getId}
      getRank={getRank}
      getLabel={(i) => i.title}
      getSubtitle={(i) => joinArtists(i.artists)}
      renderContender={renderContender}
      onDone={onDone}
    />
  );
}
