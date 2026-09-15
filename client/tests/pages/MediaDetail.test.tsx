import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MediaDetail from '../../src/pages/media/MediaDetail';
import type { MediaItem } from '../../src/types';

const getItemMock = vi.fn();
const listCheckinsMock = vi.fn();
const listsMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  media: {
    getItem: (...args: unknown[]) => getItemMock(...args),
    listCheckins: (...args: unknown[]) => listCheckinsMock(...args),
    lists: () => listsMock(),
    syncItem: () => Promise.reject(new Error('not used in tests')),
    updateItem: () => Promise.reject(new Error('not used in tests')),
  },
}));

function gameItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'game-1',
    media_type: 'game',
    external_source: 'tgdb',
    external_id: '53',
    title: 'Sonic the Hedgehog',
    author: null,
    release_year: 1991,
    image_url: null,
    external_url: 'https://thegamesdb.net/game.php?id=53',
    platform: 'Sega Genesis',
    overview: 'Join Sonic as he races through six zones.',
    content_rating: 'E - Everyone',
    players: 1,
    coop: 'No',
    genres: ['Action', 'Platform'],
    developers: ['Sega'],
    publishers: ['Sega'],
    page_count: null,
    series_name: null,
    series_position: null,
    series_count: null,
    rating: null,
    raw_score: null,
    notes: null,
    time_played_minutes: null,
    status: null,
    created_at: '2026-01-01T00:00:00Z',
    last_checkin_at: null,
    checkin_count: 0,
    my_rating: null,
    completed_count: 0,
    ...overrides,
  };
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/media/game/game-1']}>
      <Routes>
        <Route path="/media/game/:id" element={<MediaDetail subtype="game" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(gameItem());
  listCheckinsMock.mockReset();
  listCheckinsMock.mockResolvedValue([]);
  listsMock.mockReset();
  listsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe('MediaDetail (game)', () => {
  it('renders the TGDB metadata block: genres, content rating, players, bylines, overview', async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy());

    // Genre chips
    expect(screen.getByText('Action')).toBeTruthy();
    expect(screen.getByText('Platform')).toBeTruthy();
    // Content-rating badge
    expect(screen.getByText('E - Everyone')).toBeTruthy();
    // Player count
    expect(screen.getByText('1 player')).toBeTruthy();
    // Bylines
    expect(screen.getByText('Developed by Sega')).toBeTruthy();
    expect(screen.getByText('Published by Sega')).toBeTruthy();
    // Overview paragraph
    expect(screen.getByText('Join Sonic as he races through six zones.')).toBeTruthy();
    // "No" coop is not displayed
    expect(screen.queryByText('Co-op')).toBeNull();
  });

  it('shows a "Co-op" label when the game supports it', async () => {
    getItemMock.mockResolvedValue(gameItem({ coop: 'Yes' }));
    renderDetail();
    await waitFor(() => expect(screen.getByText('Co-op')).toBeTruthy());
  });

  it('renders nothing extra when all TGDB fields are null', async () => {
    getItemMock.mockResolvedValue(
      gameItem({
        overview: null,
        content_rating: null,
        players: null,
        coop: null,
        genres: null,
        developers: null,
        publishers: null,
      })
    );
    renderDetail();
    await waitFor(() => expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy());

    expect(screen.queryByText('Developed by Sega')).toBeNull();
    expect(screen.queryByText('Join Sonic as he races through six zones.')).toBeNull();
    expect(screen.queryByText('E - Everyone')).toBeNull();
    expect(screen.queryByText('1 player')).toBeNull();
  });
});
