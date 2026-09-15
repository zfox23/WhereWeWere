import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import MediaDetail from '../../src/pages/media/MediaDetail';
import type { MediaItem } from '../../src/types';

const getItemMock = vi.fn();
const listCheckinsMock = vi.fn();
const listsMock = vi.fn();
const updateItemMock = vi.fn();
vi.mock('../../src/api/client', () => ({
  media: {
    getItem: (...args: unknown[]) => getItemMock(...args),
    listCheckins: (...args: unknown[]) => listCheckinsMock(...args),
    lists: () => listsMock(),
    syncItem: () => Promise.reject(new Error('not used in tests')),
    updateItem: (...args: unknown[]) => updateItemMock(...args),
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
  updateItemMock.mockReset();
  updateItemMock.mockImplementation(async (_id: string, payload: Record<string, unknown>) => ({
    ...gameItem(),
    ...payload,
  }));
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

  it('edit mode exposes the TGDB metadata fields as editable inputs', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy());

    await user.click(screen.getByTitle('Edit metadata'));

    // Pre-populated from the item (name arrays are comma-separated).
    expect((screen.getByDisplayValue('Join Sonic as he races through six zones.') as HTMLTextAreaElement).tagName).toBe('TEXTAREA');
    expect(screen.getByDisplayValue('E - Everyone')).toBeTruthy();
    expect(screen.getByDisplayValue('1')).toBeTruthy();
    expect((screen.getByDisplayValue('Action, Platform') as HTMLInputElement).tagName).toBe('INPUT');
    // Developers and publishers are both pre-filled with "Sega".
    expect(screen.getAllByDisplayValue('Sega')).toHaveLength(2);

    // Edits each field and asserts the save payload carries the right shape.
    // (References are captured up front so re-queries don't race the edits.)
    const overview = screen.getByDisplayValue('Join Sonic as he races through six zones.') as HTMLTextAreaElement;
    const ratingInput = screen.getByDisplayValue('E - Everyone');
    const playersInput = screen.getByDisplayValue('1');
    const genres = screen.getByDisplayValue('Action, Platform');
    const devs = screen.getAllByDisplayValue('Sega')[0];
    const coopSelect = screen.getByRole('combobox', { name: /Co-op/ }) as HTMLSelectElement;

    await user.clear(overview);
    await user.type(overview, 'A fast hedgehog.');
    await user.clear(ratingInput);
    await user.type(ratingInput, 'E10+');
    await user.clear(playersInput);
    await user.type(playersInput, '2');
    await user.selectOptions(coopSelect, 'Yes');
    await user.clear(genres);
    await user.type(genres, 'Action, Racing');
    await user.clear(devs);
    await user.type(devs, 'Blue Sky');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateItemMock).toHaveBeenCalled());
    const [, payload] = updateItemMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(payload.overview).toBe('A fast hedgehog.');
    expect(payload.content_rating).toBe('E10+');
    expect(payload.players).toBe(2);
    expect(payload.coop).toBe('Yes');
    expect(payload.genres).toEqual(['Action', 'Racing']);
    expect(payload.developers).toEqual(['Blue Sky']);
    // Untouched name arrays are sent back as-is.
    expect(payload.publishers).toEqual(['Sega']);
  });

  it('sends null for blanked TGDB metadata fields', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy());

    await user.click(screen.getByTitle('Edit metadata'));

    const genres = screen.getByDisplayValue('Action, Platform');
    const ratingInput = screen.getByDisplayValue('E - Everyone');
    const playersInput = screen.getByDisplayValue('1');
    await user.clear(genres);
    await user.clear(ratingInput);
    await user.clear(playersInput);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateItemMock).toHaveBeenCalled());
    const [, payload] = updateItemMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(payload.genres).toBeNull();
    expect(payload.content_rating).toBeNull();
    expect(payload.players).toBeNull();
  });
});
