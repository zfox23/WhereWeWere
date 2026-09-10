import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MediaLibrarySection } from '../../src/components/MediaLibrarySection';
import type { MediaLibraryItem } from '../../src/types';

const libraryMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  media: {
    library: (...args: unknown[]) => libraryMock(...args),
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
});
