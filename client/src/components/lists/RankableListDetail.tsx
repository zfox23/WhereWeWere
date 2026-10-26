/**
 * A ranked list's detail view with the "Rank by comparing" tool built in: the
 * header button (or "Resume ranking" when a session is paused) swaps the view
 * for the tool, and coming back reloads the list when it changed the ranks.
 */

import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { Swords } from 'lucide-react';
import { RankedListDetail } from './RankedListDetail';
import { RankByComparing } from './RankByComparing';
import type { Contender, RankByComparingApi } from './RankByComparing';

type DetailProps<T> = Omit<ComponentProps<typeof RankedListDetail<T>>, 'headerActions'>;

export function RankableListDetail<T>({
  rankApi,
  getSubtitle,
  renderContender,
  onRankingApplied,
  ...detail
}: DetailProps<T> & {
  rankApi: RankByComparingApi;
  getSubtitle?: (item: T) => string;
  renderContender: (item: T) => Contender;
  /** Called after an applied ranking has been reloaded (e.g. to refresh an index cache). */
  onRankingApplied?: () => void;
}) {
  const { list, state, getId, getRank, getLabel } = detail;
  const [ranking, setRanking] = useState(false);
  const [paused, setPaused] = useState(false);

  // Is there a paused session to resume?
  const checkPaused = () =>
    Promise.resolve()
      .then(() => rankApi.rankSession(list.id))
      .then((s) => setPaused(s.state.answers.length > 0)).catch(() => setPaused(false));
  useEffect(() => {
    void checkPaused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id]);

  if (ranking) {
    return (
      <RankByComparing
        list={list}
        items={state.items}
        api={rankApi}
        getId={getId}
        getRank={getRank}
        getLabel={getLabel}
        getSubtitle={getSubtitle}
        renderContender={renderContender}
        onDone={(applied) => {
          setRanking(false);
          void checkPaused();
          if (applied) void state.reload().then(() => onRankingApplied?.());
        }}
      />
    );
  }

  const tooFew = state.items.length < 2;
  return (
    <RankedListDetail
      {...detail}
      headerActions={
        <button
          type="button"
          onClick={() => setRanking(true)}
          disabled={state.loading || tooFew}
          title={tooFew ? 'Add at least two items to rank them' : 'Pick between two at a time to rank the whole list'}
          className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs disabled:opacity-40"
        >
          <Swords size={13} />
          {paused ? 'Resume ranking' : 'Rank by comparing'}
        </button>
      }
    />
  );
}
