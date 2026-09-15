import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MediaLibrarySection } from '../../src/components/MediaLibrarySection';
import type { MediaLibraryItem } from '../../src/types';

const libraryMock = vi.fn();
const listsMock = vi.fn();
const removeItemFromListMock = vi.fn();
const deleteListMock = vi.fn();
const bulkDeleteItemsMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  media: {
    library: (...args: unknown[]) => libraryMock(...args),
    lists: () => listsMock(),
    removeItemFromList: (listId: string, itemId: string) => removeItemFromListMock(listId, itemId),
    deleteList: (listId: string) => deleteListMock(listId),
    bulkDeleteItems: (ids: string[], dryRun: boolean) => bulkDeleteItemsMock(ids, dryRun),
  },
}));

const item: MediaLibraryItem = {
  id: 'item-1',
  media_type: 'movie',
  title: 'Dune',
  author: 'Frank Herbert',
  image_url: 'https://example.com/dune.jpg',
  rating: 4,
  raw_score: null,
  notes: null,
  time_played_minutes: null,
  status: null,
  latest_rating: 4,
  last_checkin_at: '2023-01-04T20:00:00Z',
  last_checkin_timezone: 'UTC',
  last_checkin_type: 'completed',
  completed_count: 1,
};

function renderSection(props: { from?: string; to?: string } = {}) {
  return render(
    <MemoryRouter>
      <MediaLibrarySection from={props.from ?? ''} to={props.to ?? ''} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  libraryMock.mockReset();
  libraryMock.mockResolvedValue([item]);
  listsMock.mockReset();
  listsMock.mockResolvedValue([]);
  removeItemFromListMock.mockReset();
  removeItemFromListMock.mockResolvedValue({ message: 'removed' });
  deleteListMock.mockReset();
  deleteListMock.mockResolvedValue({ message: 'deleted', id: 'list-1' });
  bulkDeleteItemsMock.mockReset();
  bulkDeleteItemsMock.mockResolvedValue({ deleted_items: 1, deleted_checkins: 1, deleted_list_memberships: 0 });
  window.history.pushState({}, '', '/profile?tab=media');
});

afterEach(() => {
  cleanup();
});

describe('MediaLibrarySection', () => {
  it('renders one card per media item with title, rating, and last check-in date', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());

    const card = screen.getByRole('link', { name: /Dune/ });
    expect(card.getAttribute('href')).toBe('/media/movie/item-1/dune');
    expect(screen.getByText('Frank Herbert')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText(/Jan 4, 2023, 8:00 PM/)).toBeTruthy();
  });

  it('shows total time played on game cards only', async () => {
    libraryMock.mockResolvedValueOnce([
      { ...item, id: 'g1', title: 'Hades', media_type: 'game', time_played_minutes: 330 },
      { ...item, id: 'g2', title: 'Celeste', media_type: 'game', time_played_minutes: null },
      { ...item, id: 'm1', title: 'Dune', media_type: 'movie', time_played_minutes: 330 },
    ]);
    renderSection();
    await waitFor(() => expect(screen.getByText('Hades')).toBeTruthy());

    // Games show the running total…
    expect(screen.getByText('5h 30m played')).toBeTruthy();
    // …unless no time has been reported.
    expect(screen.getByRole('link', { name: /Celeste/ }).textContent).not.toContain('played');
    // Non-game items never show time played.
    expect(screen.getByRole('link', { name: /Dune/ }).textContent).not.toContain('played');
  });

  it('shows the completed count in the badge when an item has been completed multiple times', async () => {
    libraryMock.mockResolvedValueOnce([{ ...item, completed_count: 3 }]);
    renderSection();
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    expect(screen.getByText('Completed 3x')).toBeTruthy();
  });

  it('fetches with the date range and selected types', async () => {
    renderSection({ from: '2023-01-01', to: '2023-01-31' });
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());

    expect(libraryMock).toHaveBeenCalledWith('2023-01-01', '2023-01-31', [
      'movie', 'tv_show', 'game', 'book', 'board_game',
    ]);
  });

  it('toggles media type filters and refetches', async () => {
    renderSection();
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Movies' }));
    await user.click(screen.getByRole('button', { name: 'TV Shows' }));
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await user.click(screen.getByRole('button', { name: 'Books' }));
    await user.click(screen.getByRole('button', { name: 'Board Games' }));

    // With no types selected, the empty state shows and no fetch used an empty type list.
    expect(await screen.findByText('Select at least one media type to view.')).toBeTruthy();
    expect(libraryMock.mock.calls.some(([, , types]) => types.length === 0)).toBe(false);
  });

  it('shows an empty state when the API returns no items', async () => {
    libraryMock.mockResolvedValueOnce([]);
    renderSection();
    await waitFor(() => expect(screen.getByText('No media checked in during this period.')).toBeTruthy());
  });

  it('sorts items by the selected key and direction', async () => {
    libraryMock.mockResolvedValueOnce([
      { ...item, id: 'a', title: 'Alpha', latest_rating: 2, last_checkin_at: '2023-01-01T00:00:00Z', completed_count: 1 },
      { ...item, id: 'b', title: 'Bravo', latest_rating: 5, last_checkin_at: '2023-01-02T00:00:00Z', completed_count: 3 },
      { ...item, id: 'c', title: 'Charlie', latest_rating: null, last_checkin_at: '2023-01-03T00:00:00Z', completed_count: 0 },
    ]);
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    const cardTitles = () =>
      screen.getAllByRole('link').map((el) => el.textContent ?? '');
    const orderOf = (...titles: string[]) =>
      titles.map((t) => cardTitles().findIndex((text) => text.includes(t)));
    // Default: last check-in descending.
    expect(orderOf('Charlie', 'Bravo', 'Alpha')).toEqual([0, 1, 2]);

    // Switch to rating descending first, then toggle to ascending; unrated items sort last in desc, first in asc.
    const select = screen.getByRole('combobox', { name: 'Sort library by' });
    await user.selectOptions(select, 'rating');
    expect(orderOf('Bravo', 'Alpha', 'Charlie')).toEqual([0, 1, 2]);
    // Direction starts as descending; button offers the switch to ascending.
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    expect(orderOf('Charlie', 'Alpha', 'Bravo')).toEqual([0, 1, 2]);

    // Completed count ascending (0, 1, 3).
    await user.selectOptions(select, 'completed');
    expect(orderOf('Charlie', 'Alpha', 'Bravo')).toEqual([0, 1, 2]);
  });

  it('sorts by time played and narrows the library to games when selected', async () => {
    libraryMock.mockResolvedValue([
      { ...item, id: 'a', title: 'Alpha', media_type: 'game', time_played_minutes: 120, last_checkin_at: '2023-01-01T00:00:00Z' },
      { ...item, id: 'b', title: 'Bravo', media_type: 'game', time_played_minutes: 300, last_checkin_at: '2023-01-02T00:00:00Z' },
      { ...item, id: 'c', title: 'Charlie', media_type: 'game', time_played_minutes: null, last_checkin_at: '2023-01-03T00:00:00Z' },
    ]);
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    const select = screen.getByRole('combobox', { name: 'Sort library by' });
    await user.selectOptions(select, 'time_played');

    // Choosing time played narrows the media type filter to games.
    await waitFor(() =>
      expect(libraryMock).toHaveBeenLastCalledWith(undefined, undefined, ['game'])
    );
    // Non-game type chips are no longer active.
    expect(screen.getByRole('button', { name: 'Movies', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Games', pressed: true })).toBeTruthy();

    // Time played descending (300, 120, none); ties/unplayed sort last.
    const cardTitles = () => screen.getAllByRole('link').map((el) => el.textContent ?? '');
    const orderOf = (...titles: string[]) =>
      titles.map((t) => cardTitles().findIndex((text) => text.includes(t)));
    expect(orderOf('Bravo', 'Alpha', 'Charlie')).toEqual([0, 1, 2]);

    // Toggle to ascending: unplayed first.
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    expect(orderOf('Charlie', 'Alpha', 'Bravo')).toEqual([0, 1, 2]);
  });

  it('falls back to the default sort when games are filtered out while sorting by time played', async () => {
    libraryMock.mockResolvedValue([
      { ...item, id: 'a', title: 'Alpha', media_type: 'game', time_played_minutes: 120 },
      { ...item, id: 'b', title: 'Bravo', media_type: 'game', time_played_minutes: 300 },
    ]);
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    const select = screen.getByRole('combobox', { name: 'Sort library by' });
    await user.selectOptions(select, 'time_played');
    expect(select).toHaveValue('time_played');

    // Deselect games via the type chips: time played no longer applies.
    await user.click(screen.getByRole('button', { name: 'Games' }));
    await waitFor(() => expect(select).toHaveValue('checkin'));
  });

  it('sorts by time added to this list when a list is selected', async () => {
    libraryMock.mockResolvedValueOnce([
      { ...item, id: 'a', title: 'Alpha', last_checkin_at: '2023-03-01T00:00:00Z' },
      { ...item, id: 'b', title: 'Bravo', last_checkin_at: '2023-03-02T00:00:00Z' },
      { ...item, id: 'c', title: 'Charlie', last_checkin_at: '2023-03-03T00:00:00Z' },
    ]);
    listsMock.mockResolvedValueOnce([
      {
        id: 'list-1',
        name: 'Watchlist',
        created_at: '2023-01-01T00:00:00Z',
        items: [
          { id: 'a', media_type: 'movie', title: 'Alpha', image_url: null, author: null, added_at: '2023-05-03T00:00:00Z' },
          { id: 'b', media_type: 'movie', title: 'Bravo', image_url: null, author: null, added_at: '2023-05-01T00:00:00Z' },
          { id: 'c', media_type: 'movie', title: 'Charlie', image_url: null, author: null, added_at: '2023-05-02T00:00:00Z' },
        ],
      },
    ]);
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    const listSelect = screen.getByRole('combobox', { name: 'Filter by list' });
    await user.selectOptions(listSelect, 'list-1');

    const cardTitles = () => screen.getAllByRole('link').map((el) => el.textContent ?? '');
    const orderOf = (...titles: string[]) =>
      titles.map((t) => cardTitles().findIndex((text) => text.includes(t)));

    // Last check-in descending (default) is independent of time added.
    expect(orderOf('Charlie', 'Bravo', 'Alpha')).toEqual([0, 1, 2]);

    const sortSelect = screen.getByRole('combobox', { name: 'Sort library by' });
    await user.selectOptions(sortSelect, 'list');
    // Default direction is descending: most recently added first.
    expect(orderOf('Alpha', 'Charlie', 'Bravo')).toEqual([0, 1, 2]);
    await user.click(screen.getByRole('button', { name: 'Sort ascending' }));
    expect(orderOf('Bravo', 'Charlie', 'Alpha')).toEqual([0, 1, 2]);
  });

  it('filters the library to items on the selected list and offers per-card removal', async () => {
    libraryMock.mockResolvedValueOnce([
      { ...item, id: 'a', title: 'Alpha' },
      { ...item, id: 'b', title: 'Bravo' },
    ]);
    listsMock.mockResolvedValueOnce([
      {
        id: 'list-1',
        name: 'Watchlist',
        created_at: '2023-01-01T00:00:00Z',
        items: [{ id: 'a', media_type: 'movie', title: 'Alpha', image_url: null, author: null, added_at: '2023-05-01T00:00:00Z' }],
      },
    ]);
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Bravo')).toBeTruthy());

    // No list selected: both items show, no remove buttons.
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove from Watchlist' })).toBeNull();

    // Select the list: only its items show, with a remove button.
    const listSelect = screen.getByRole('combobox', { name: 'Filter by list' });
    await user.selectOptions(listSelect, 'list-1');
    await waitFor(() => expect(screen.queryByText('Bravo')).toBeNull());
    expect(screen.getByText('Alpha')).toBeTruthy();

    const removeBtn = screen.getByRole('button', { name: 'Remove from Watchlist' });
    // Confirm the removal.
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(removeBtn);
    expect(confirmSpy).toHaveBeenCalledWith('Remove "Alpha" from "Watchlist"?');
    expect(removeItemFromListMock).toHaveBeenCalledWith('list-1', 'a');
    // Item disappears from the filtered view after local removal.
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(screen.getByText(/No media from "Watchlist"/)).toBeTruthy();
    confirmSpy.mockRestore();
  });

  it('deletes the selected list after confirmation', async () => {
    listsMock.mockResolvedValueOnce([
      {
        id: 'list-1',
        name: 'Watchlist',
        created_at: '2023-01-01T00:00:00Z',
        items: [{ id: 'item-1', media_type: 'movie', title: 'Dune', image_url: null, author: null, added_at: '2023-05-01T00:00:00Z' }],
      },
    ]);
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());

    // Select the list so the delete button appears.
    const listSelect = screen.getByRole('combobox', { name: 'Filter by list' });
    await user.selectOptions(listSelect, 'list-1');
    const deleteBtn = await screen.findByRole('button', { name: 'Delete list Watchlist' });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(deleteBtn);
    expect(confirmSpy).toHaveBeenCalledWith('Delete list "Watchlist"? Items in your library are kept.');
    expect(deleteListMock).toHaveBeenCalledWith('list-1');
    // Dropdown resets to "All media" after deletion.
    await waitFor(() => expect((listSelect as HTMLSelectElement).value).toBe(''));
    expect(screen.queryByRole('button', { name: 'Delete list Watchlist' })).toBeNull();
    confirmSpy.mockRestore();
  });
});

describe('MediaLibrarySection batch edit mode', () => {
  const threeItems: MediaLibraryItem[] = [
    { ...item, id: 'a', title: 'Alpha' },
    { ...item, id: 'b', title: 'Bravo' },
    { ...item, id: 'c', title: 'Charlie' },
  ];

  const EDIT_BUTTON = 'Edit mode: select items for batch operations';

  async function enterEditMode(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: EDIT_BUTTON }));
  }

  beforeEach(() => {
    libraryMock.mockResolvedValue(threeItems);
  });

  it('shows a checkbox on each card and toggles selection on click', async () => {
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    // Cards are links until edit mode is entered.
    expect(screen.getByRole('link', { name: /Alpha/ })).toBeTruthy();
    await enterEditMode(user);

    // Clicking a card's checkbox selects it.
    expect(screen.getByRole('button', { name: 'Alpha', pressed: false })).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    expect(screen.getByRole('button', { name: 'Alpha', pressed: true })).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();

    // Clicking a second checkbox adds to the selection.
    await user.click(screen.getByRole('checkbox', { name: 'Select Charlie' }));
    expect(screen.getByRole('button', { name: 'Charlie', pressed: true })).toBeTruthy();
    expect(screen.getByText('2 selected')).toBeTruthy();

    // Clicking a selected card again deselects it.
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    expect(screen.getByRole('button', { name: 'Alpha', pressed: false })).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();

    // Done exits edit mode, restores the links, and clears the selection.
    await user.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(screen.queryByRole('checkbox', { name: 'Select Alpha' })).toBeNull();
    expect(screen.getByRole('link', { name: /Alpha/ })).toBeTruthy();
  });

  it('selects a range when shift-clicking a checkbox', async () => {
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await enterEditMode(user);

    // Anchor on the first card, then shift-click the last: the whole range is selected.
    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select Charlie' }));
    await user.keyboard('{/Shift}');

    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alpha', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bravo', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Charlie', pressed: true })).toBeTruthy();
  });

  it('deletes selected items after a confirmation showing item and check-in counts', async () => {
    bulkDeleteItemsMock
      .mockResolvedValueOnce({ deleted_items: 2, deleted_checkins: 5, deleted_list_memberships: 1 })
      .mockResolvedValueOnce({ deleted_items: 2, deleted_checkins: 5, deleted_list_memberships: 1 });
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await enterEditMode(user);

    await user.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select Bravo' }));
    await user.keyboard('{/Shift}');
    await user.click(screen.getByRole('button', { name: 'Delete 2 selected items' }));

    // Deleting first requests a dry-run preview for the confirmation dialog.
    expect(bulkDeleteItemsMock).toHaveBeenLastCalledWith(['a', 'b'], true);
    await waitFor(() => expect(screen.getByText('Delete 2 media items?')).toBeTruthy());
    const body = screen.getByText((_, el) => el?.tagName === 'P' && /permanently delete/.test(el.textContent ?? ''));
    expect(body.textContent).toMatch(/2 media items and 5 check-ins/);
    expect(body.textContent).toMatch(/removed from any lists they belong to/);

    // Cancelling keeps the items and performs no deletion.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bulkDeleteItemsMock.mock.calls.length).toBe(1);
    expect(screen.queryByText('Delete 2 media items?')).toBeNull();
    expect(screen.getByText('Alpha')).toBeTruthy();

    // Re-open the confirmation and confirm: the real delete runs and the
    // deleted items disappear from the library.
    await user.click(screen.getByRole('button', { name: 'Delete 2 selected items' }));
    await waitFor(() => expect(screen.getByText('Delete 2 media items?')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(bulkDeleteItemsMock).toHaveBeenLastCalledWith(['a', 'b'], false);
    await waitFor(() => {
      expect(screen.queryByText('Alpha')).toBeNull();
      expect(screen.queryByText('Bravo')).toBeNull();
    });
    expect(screen.getByText('Charlie')).toBeTruthy();
    expect(screen.getByText('0 selected')).toBeTruthy();
  });

  it('disables the delete button when nothing is selected', async () => {
    renderSection();
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    await enterEditMode(user);

    const deleteButton = screen.getByRole('button', { name: 'Delete 0 selected items' });
    expect(deleteButton).toBeDisabled();
    await user.click(deleteButton);
    expect(bulkDeleteItemsMock).not.toHaveBeenCalled();
  });
});
