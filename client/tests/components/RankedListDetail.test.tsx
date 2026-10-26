import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RankedListDetail, compareByRank, useRankedList } from '../../src/components/lists/RankedListDetail';

interface Row { id: string; name: string; rank: number | null }
const rows = (...r: Row[]) => r;
const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);

describe('compareByRank', () => {
  const cmp = compareByRank<Row>((r) => r.rank, byName);
  it('orders ranked items by rank and sinks unranked ones, ordered by the tiebreak', () => {
    const sorted = [
      { id: '1', name: 'b', rank: null }, { id: '2', name: 'z', rank: 2 },
      { id: '3', name: 'a', rank: null }, { id: '4', name: 'y', rank: 1 },
    ].sort(cmp);
    expect(sorted.map((r) => r.id)).toEqual(['4', '2', '3', '1']);
  });
});

const api = { items: vi.fn(), reRank: vi.fn(), remove: vi.fn() };

function Harness({ onChanged }: { onChanged?: () => void }) {
  const state = useRankedList<Row>({
    listId: 'l1', api, getId: (r) => r.id, withRank: (r, rank) => ({ ...r, rank }), onChanged,
  });
  return (
    <RankedListDetail
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
      onRemove={(r) => api.remove(r.id)}
    />
  );
}

describe('RankedListDetail + useRankedList', () => {
  beforeEach(() => {
    Object.values(api).forEach((m) => m.mockReset());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('loads the items and shows the count', async () => {
    api.items.mockResolvedValue(rows({ id: 'a', name: 'Alpha', rank: 1 }, { id: 'b', name: 'Beta', rank: null }));
    render(<Harness />);
    expect(await screen.findByText('2 things')).toBeTruthy();
    expect(api.items).toHaveBeenCalledWith('l1');
  });

  it('says so when the list is empty', async () => {
    api.items.mockResolvedValue([]);
    render(<Harness />);
    expect(await screen.findByText('Nothing yet')).toBeTruthy();
  });

  it('removing confirms, calls the plugin, reloads and reports the change', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    api.items.mockResolvedValue(rows({ id: 'a', name: 'Alpha', rank: 1 }, { id: 'b', name: 'Beta', rank: 2 }));
    api.remove.mockImplementation(async () => {
      api.items.mockResolvedValue(rows({ id: 'b', name: 'Beta', rank: 1 }));
    });
    render(<Harness onChanged={onChanged} />);
    await user.click(await screen.findByRole('button', { name: 'Actions for Alpha' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from list' }));

    expect(window.confirm).toHaveBeenCalledWith('Remove Alpha?');
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(api.remove).toHaveBeenCalledWith('a');
    expect(onChanged).toHaveBeenCalled();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    vi.mocked(window.confirm).mockReturnValue(false);
    api.items.mockResolvedValue(rows({ id: 'a', name: 'Alpha', rank: 1 }));
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: 'Actions for Alpha' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from list' }));
    expect(api.remove).not.toHaveBeenCalled();
  });
});
