import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TvEpisodePicker from '../../src/pages/media/TvEpisodePicker';

const apiMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  tvSeasons: vi.fn(),
}));

vi.mock('../../src/api/client', () => ({
  media: {
    getItem: apiMocks.getItem,
    tvSeasons: apiMocks.tvSeasons,
  },
}));

const item = {
  id: 'item-1',
  media_type: 'tv_show',
  external_source: 'tmdb',
  external_id: '100088',
  title: 'The Last of Us',
  author: null,
  release_year: 2023,
  image_url: null,
  external_url: null,
  created_at: '2023-01-01T00:00:00Z',
};

const seasons = [
  {
    season_number: 1,
    episodes: [
      { episode_number: 1, episode_title: 'Long, Long Time' },
      { episode_number: 2, episode_title: 'Infected' },
    ],
  },
  {
    season_number: 2,
    episodes: [{ episode_number: 1, episode_title: 'Abandoned' }],
  },
];

function renderPicker() {
  return render(
    <MemoryRouter initialEntries={['/media-check-in/tv/item-1/the-last-of-us']}>
      <Routes>
        <Route path="/media-check-in/tv/:id/:slug" element={<TvEpisodePicker />} />
        <Route
          path="/media-check-in/tv/:id/:slug/:season/:episode"
          element={<div id="target">episode form target</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TvEpisodePicker', () => {
  beforeEach(() => {
    apiMocks.getItem.mockReset();
    apiMocks.tvSeasons.mockReset();
    apiMocks.getItem.mockResolvedValue(item);
    apiMocks.tvSeasons.mockResolvedValue({ seasons, cached: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads the show and defaults to the first season', async () => {
    renderPicker();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'The Last of Us' })).toBeTruthy();
    });

    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('1');
    expect(screen.getByText('Long, Long Time')).toBeTruthy();
    expect(screen.getByText('Infected')).toBeTruthy();
  });

  it('switches seasons via the dropdown', async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText('Long, Long Time')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.selectOptions(document.querySelector('select')!, '2');

    expect(screen.getByText('Abandoned')).toBeTruthy();
    expect(screen.queryByText('Long, Long Time')).toBeNull();
  });

  it('navigates to the chosen episode check-in form', async () => {
    renderPicker();
    await waitFor(() => {
      expect(screen.getByText('Infected')).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Infected/ }));

    await waitFor(() => {
      expect(screen.getByText('episode form target')).toBeTruthy();
    });
  });

  it('shows an empty state when no seasons are available', async () => {
    apiMocks.tvSeasons.mockResolvedValue({ seasons: [], cached: false });
    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(/no season\/episode data available/i)).toBeTruthy();
    });
  });

  it('shows an error state when loading fails', async () => {
    apiMocks.getItem.mockRejectedValue(new Error('boom'));
    renderPicker();

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeTruthy();
    });
  });
});
