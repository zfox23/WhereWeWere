import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RankableListDetail } from '../../src/components/lists/RankableListDetail';
import { useRankedList } from '../../src/components/lists/RankedListDetail';

interface Row { id: string; name: string; rank: number | null }
const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);

const api = {
  items: vi.fn(),
  reRank: vi.fn(),
  rankList: vi.fn(),
  rankSession: vi.fn(),
  saveRankSession: vi.fn(),
  discardRankSession: vi.fn(),
};

function Harness() {
  const state = useRankedList<Row>({ listId: 'l1', api, getId: (r) => r.id, withRank: (r, rank) => ({ ...r, rank }) });
  return (
    <RankableListDetail
      list={{ id: 'l1', name: 'Faves' }}
      onBack={() => {}}
      state={state}
      itemNoun="thing"
      emptyText="Nothing yet"
      getId={(r) => r.id}
      getRank={(r) => r.rank}
      getLabel={(r) => r.name}
      columns={[{ key: 'name', label: 'Name', render: (r: Row) => r.name }]}
      renderCard={(r: Row) => r.name}
      sortOptions={[{ key: 'rank', label: 'Rank', defaultDir: 'asc' }]}
      compareBy={() => 0}
      compareUnranked={byName}
      removeMessage={(r) => `Remove ${r.name}?`}
      onRemove={async () => {}}
      rankApi={api}
      renderContender={(r) => ({ body: <p>{`card ${r.name}`}</p> })}
    />
  );
}

describe('RankableListDetail', () => {
  beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
    api.items.mockResolvedValue([{ id: 'a', name: 'Alpha', rank: null }, { id: 'b', name: 'Beta', rank: null }]);
    api.rankSession.mockRejectedValue(new Error('none'));
    api.saveRankSession.mockResolvedValue({ saved: true });
    api.discardRankSession.mockResolvedValue({ deleted: true });
    api.rankList.mockResolvedValue({ ranked_ids: [] });
  });
  afterEach(cleanup);

  it('offers to rank by comparing, runs a duel and applies the result', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Rank by comparing' }));
    // Nothing is ranked, so it starts straight away with a duel.
    expect(await screen.findByText('Which do you like more?')).toBeTruthy();
    expect(screen.getByText('card Alpha')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: /Prefer/ })[0]);
    await user.click(await screen.findByRole('button', { name: /Apply this ranking/ }));
    await waitFor(() => expect(api.rankList).toHaveBeenCalledTimes(1));
    expect(api.rankList.mock.calls[0][0]).toBe('l1');
    expect(api.rankList.mock.calls[0][1]).toHaveLength(2);
    expect(api.discardRankSession).toHaveBeenCalledWith('l1');
    // Back on the list, reloaded.
    expect(await screen.findByRole('button', { name: /Rank by comparing|Resume ranking/ })).toBeTruthy();
    expect(api.items.mock.calls.length).toBeGreaterThan(1);
  });

  it('says "Resume ranking" when a session with answers is paused', async () => {
    api.rankSession.mockResolvedValue({
      state: { mode: 'scratch', initialRanks: { a: null, b: null }, itemIds: ['a', 'b'], answers: [{ a: 'a', b: 'b', r: 'a' }] },
    });
    render(<Harness />);
    expect(await screen.findByRole('button', { name: 'Resume ranking' })).toBeTruthy();
  });

  it('disables ranking for a list of fewer than two items', async () => {
    api.items.mockResolvedValue([{ id: 'a', name: 'Alpha', rank: null }]);
    render(<Harness />);
    const button = (await screen.findByRole('button', { name: 'Rank by comparing' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
