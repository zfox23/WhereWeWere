import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MediaDetail from '../ui/pages/MediaDetail';
import type { MediaItem } from '../ui/types';

const getItemMock = vi.fn();
const listCheckinsMock = vi.fn();
const listsMock = vi.fn();
const updateItemMock = vi.fn();
const syncItemMock = vi.fn();
vi.mock('../ui/api', () => ({
  media: {
    getItem: (...args: unknown[]) => getItemMock(...args),
    listCheckins: (...args: unknown[]) => listCheckinsMock(...args),
    lists: () => listsMock(),
    syncItem: (...args: unknown[]) => syncItemMock(...args),
    updateItem: (...args: unknown[]) => updateItemMock(...args),
  },
}));

function gameItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'game-1',
    media_type: 'game',
    external_source: 'igdb',
    external_id: '53',
    title: 'Sonic the Hedgehog',
    author: null,
    release_year: 1991,
    image_url: null,
    external_url: 'https://www.igdb.com/games/53',
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
  syncItemMock.mockReset();
  syncItemMock.mockResolvedValue({ provider: 'IGDB', found: true, metadata: {} });
});

afterEach(() => {
  cleanup();
});

describe('MediaDetail (game)', () => {
  it('renders the IGDB metadata block: genres, content rating, players, bylines, overview', async () => {
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

  it('renders nothing extra when all IGDB fields are null', async () => {
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

  it('edit mode exposes the IGDB metadata fields as editable inputs', async () => {
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

  it('sends null for blanked IGDB metadata fields', async () => {
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

  it('sync diff includes external id/url plus all IGDB game fields', async () => {
    const user = userEvent.setup();
    // Provider values differ on every stored game field.
    syncItemMock.mockResolvedValue({
      provider: 'IGDB',
      found: true,
      metadata: {
        title: 'Sonic the Hedgehog',
        release_year: 1991,
        image_url: 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg',
        external_id: '54',
        external_url: 'https://www.igdb.com/games/54',
        platform: 'Sega Genesis',
        overview: 'Updated synopsis.',
        content_rating: 'E10+ - Everyone 10+',
        players: 2,
        coop: 'Yes',
        genres: ['Action', 'Racing'],
        developers: ['Blue Sky'],
        publishers: ['Sega of America'],
      },
    });
    renderDetail();
    await waitFor(() => expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy());

    await user.click(screen.getByTitle('Edit metadata'));
    await user.click(screen.getByRole('button', { name: 'Sync metadata from IGDB' }));

    // Every changed stored field appears as a proposed change row. Scope to the
    // diff list because the open edit form shows the same field labels.
    const heading = await screen.findByText('Proposed changes from IGDB');
    const diffList = heading.parentElement!.nextElementSibling as HTMLUListElement;
    const diffText = diffList.textContent || '';
    for (const label of [
      'External ID', 'External URL', 'Image URL', 'Overview', 'Content rating',
      'Players', 'Co-op', 'Genres', 'Developers', 'Publishers',
    ]) {
      expect(diffText).toContain(label);
    }
    // Untouched fields (title, release year, platform) are not proposed as
    // rows (exact label match, since "Platform" also appears in the genres value).
    const labels = [...diffList.querySelectorAll('div.text-xs.font-medium')].map((el) => el.textContent);
    expect(labels).not.toContain('Release year');
    expect(labels).not.toContain('Platform');
    expect(labels).not.toContain('Title');
  });

  it('syncs against the draft title/external id, not the saved values (no pre-save)', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() => expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy());

    await user.click(screen.getByTitle('Edit metadata'));

    // Edit the title and external ID in the form without saving.
    const titleInput = screen.getByDisplayValue('Sonic the Hedgehog');
    await user.clear(titleInput);
    await user.type(titleInput, 'Sonic the Hedgehog (1991)');
    const idInput = screen.getByDisplayValue('53');
    await user.clear(idInput);
    await user.type(idInput, '54');

    await user.click(screen.getByRole('button', { name: 'Sync metadata from IGDB' }));

    // The sync request carries the current draft values, and the item is NOT
    // saved first (the old save-then-sync round trip is gone).
    await waitFor(() => expect(syncItemMock).toHaveBeenCalledWith('game-1', {
      title: 'Sonic the Hedgehog (1991)',
      external_id: '54',
    }));
    expect(updateItemMock).not.toHaveBeenCalled();
  });

  it('labels the provider by the item source: IGDB for igdb-sourced games', async () => {
    const user = userEvent.setup();
    syncItemMock.mockResolvedValue({ provider: 'IGDB', found: true, metadata: {} });
    getItemMock.mockResolvedValue(
      gameItem({
        external_source: 'igdb',
        external_id: '1942',
        external_url: 'https://www.igdb.com/games/halo',
        title: 'Halo',
      })
    );
    renderDetail();
    await waitFor(() => expect(screen.getByText('Halo')).toBeTruthy());

    await user.click(screen.getByTitle('Edit metadata'));
    // The sync button reflects the item's own source, not the primary provider.
    await user.click(screen.getByRole('button', { name: 'Sync metadata from IGDB' }));

    await screen.findByText('Metadata from IGDB is already up to date.');
  });
});

describe('MediaDetail back button', () => {
  // Renders the router location so tests can assert which filters were
  // restored on the (mock) profile page.
  function ProfileProbe() {
    const loc = useLocation();
    return <div>media library{loc.search}</div>;
  }

  function renderBack(entry: { pathname: string; state?: unknown }) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/profile" element={<ProfileProbe />} />
          <Route path="/media-check-in/game" element={<div>media check-in</div>} />
          <Route path="/media/game/:id" element={<MediaDetail subtype="game" />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('deep-links back to the library with its filters via navigation state', async () => {
    renderBack({
      pathname: '/media/game/game-1',
      state: { mediaFrom: '/profile?tab=plugin:media&mediaMonth=2026-09&mediaTypes=game' },
    });
    await waitFor(() => expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    await waitFor(() =>
      expect(screen.getByText('media library?tab=plugin:media&mediaMonth=2026-09&mediaTypes=game')).toBeTruthy(),
    );
  });

  it('falls back to the check-in search screen when mediaFrom is absent', async () => {
    renderBack({ pathname: '/media/game/game-1' });
    await waitFor(() => expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    await waitFor(() => expect(screen.getByText('media check-in')).toBeTruthy());
  });

  it('ignores a mediaFrom value that does not start with a slash', async () => {
    renderBack({ pathname: '/media/game/game-1', state: { mediaFrom: 'https://evil.example' } });
    await waitFor(() => expect(screen.getByText('Sonic the Hedgehog')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    await waitFor(() => expect(screen.getByText('media check-in')).toBeTruthy());
  });
});
