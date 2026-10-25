import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MediaCheckInForm from '../ui/pages/MediaCheckInForm';

const apiMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  lists: vi.fn(),
  addItemToList: vi.fn(),
}));

vi.mock('../ui/api', () => ({
  media: {
    getItem: apiMocks.getItem,
    lists: apiMocks.lists,
    addItemToList: apiMocks.addItemToList,
  },
}));

const item = {
  id: 'item-1',
  media_type: 'movie',
  external_source: 'tmdb',
  external_id: '1',
  title: 'Heat',
  author: null,
  release_year: 1995,
  image_url: null,
  external_url: null,
  created_at: '2023-01-01T00:00:00Z',
};

function renderForm(episodeMode?: { seasonNumber: number; episodeNumber: number }) {
  return render(
    <MemoryRouter initialEntries={['/media-check-in/movie/item-1/heat']}>
      <Routes>
        <Route
          path="/media-check-in/movie/:id/:slug"
          element={<MediaCheckInForm subtype={episodeMode ? 'tv_show' : 'movie'} episodeMode={episodeMode} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MediaCheckInForm add to list', () => {
  beforeEach(() => {
    apiMocks.getItem.mockReset();
    apiMocks.getItem.mockResolvedValue(item);
    apiMocks.lists.mockReset();
    apiMocks.lists.mockResolvedValue([{ id: 'list-1', name: 'Watchlist', created_at: '', items: [] }]);
    apiMocks.addItemToList.mockReset();
    apiMocks.addItemToList.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('adds the item to a list without checking in', async () => {
    renderForm();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /add to list/i }));
    await user.click(await screen.findByRole('button', { name: 'Watchlist' }));

    await waitFor(() => {
      expect(apiMocks.addItemToList).toHaveBeenCalledWith('list-1', 'item-1');
    });
    expect(screen.getByRole('button', { name: /submit check-in/i })).toBeTruthy();
  });

  it('hides the button on the episode check-in form', async () => {
    renderForm({ seasonNumber: 1, episodeNumber: 2 });
    await screen.findByRole('button', { name: /submit check-in/i });
    expect(screen.queryByRole('button', { name: /add to list/i })).toBeNull();
  });
});
