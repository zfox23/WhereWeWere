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
vi.mock('../../src/api/client', () => ({
  media: {
    library: (...args: unknown[]) => libraryMock(...args),
    lists: () => listsMock(),
    removeItemFromList: (listId: string, itemId: string) => removeItemFromListMock(listId, itemId),
    deleteList: (listId: string) => deleteListMock(listId),
  },
}));

const item: MediaLibraryItem = {
  id: 'item-1',
  media_type: 'movie',
  title: 'Dune',
  author: 'Frank Herbert',
  image_url: 'https://example.com/dune.jpg',
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
        items: [{ id: 'a', media_type: 'movie', title: 'Alpha', image_url: null, author: null }],
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
        items: [{ id: 'item-1', media_type: 'movie', title: 'Dune', image_url: null, author: null }],
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
