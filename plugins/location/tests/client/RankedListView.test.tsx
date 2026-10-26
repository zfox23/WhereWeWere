import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RankedListView, moveToRank } from '../../../../client/src/components/lists/RankedListView';

interface Row {
  id: string;
  name: string;
  rank: number | null;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', rank: 1 },
  { id: 'b', name: 'Bravo', rank: 2 },
  { id: 'c', name: 'Charlie', rank: null },
];

function setup(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobile ? false : query.includes('min-width'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const onReorder = vi.fn().mockResolvedValue(undefined);
  render(
    <RankedListView<Row>
      items={ROWS}
      getId={(r) => r.id}
      getRank={(r) => r.rank}
      getLabel={(r) => r.name}
      columns={[{ key: 'name', label: 'Name', render: (r) => r.name }]}
      renderCard={(r) => <span>{r.name}</span>}
      sortOptions={[
        { key: 'rank', label: 'Rank', defaultDir: 'asc' },
        { key: 'name', label: 'Name', defaultDir: 'asc' },
      ]}
      compareBy={(k, a, b) => (k === 'name' ? a.name.localeCompare(b.name) : 0)}
      compareUnranked={(a, b) => a.name.localeCompare(b.name)}
      onReorder={onReorder}
      onRemove={() => {}}
    />
  );
  return { onReorder };
}

afterEach(cleanup);

describe('moveToRank', () => {
  it('moves, clamps and appends', () => {
    expect(moveToRank(['a', 'b', 'c'], 'c', 1)).toEqual(['c', 'a', 'b']);
    expect(moveToRank(['a', 'b'], 'a', 99)).toEqual(['b', 'a']);
    expect(moveToRank(['a', 'b'], 'z', 3)).toEqual(['a', 'b', 'z']);
  });
});

describe('RankedListView layouts', () => {
  it('renders a table at md+ and cards on phones', () => {
    setup(false);
    expect(document.querySelector('table')).not.toBeNull();
    cleanup();
    setup(true);
    expect(document.querySelector('table')).toBeNull();
    expect(screen.getByLabelText('Sort by')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Unranked' })).toBeTruthy();
  });

  it('phone cards support the move menu', async () => {
    const user = userEvent.setup();
    const { onReorder } = setup(true);
    await user.click(screen.getByRole('button', { name: 'Actions for Bravo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Move to top' }));
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(['b', 'a']));
  });

  it('hides drag handles when sorted by anything but rank', async () => {
    const user = userEvent.setup();
    setup(true);
    expect(screen.getByRole('button', { name: 'Drag to reorder Alpha' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Sort by'), 'name');
    expect(screen.queryByRole('button', { name: /Drag to reorder/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Unranked' })).toBeNull();
  });
});
