import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicTab } from '../ui/MusicTab';

const statsMock = vi.fn();
const libraryMock = vi.fn();
const albumViewMock = vi.fn();
const createFromMock = vi.fn();
const clockMock = vi.fn();
const discoveryMock = vi.fn();
const dailyMock = vi.fn();
let listsData: any[] = [];
vi.mock('../ui/api', () => ({
  // Spotify isn't set up: its buttons and the Playlists subtab stay hidden.
  spotify: { status: () => Promise.resolve({ configured: false, connected: false }) },
  music: {
    stats: (...args: unknown[]) => statsMock(...args),
    library: (...args: unknown[]) => libraryMock(...args),
    lists: () => Promise.resolve(JSON.parse(JSON.stringify(listsData))),
    createListFromItems: (...args: unknown[]) => createFromMock(...args),
    listItems: () => Promise.resolve([]),
    listSeries: () => Promise.resolve({ bands: [], other: { plays: 0, count: 0, daily: [] } }),
    rankSession: () => Promise.reject(new Error('none')),
    albumView: (...args: unknown[]) => albumViewMock(...args),
    listeningClock: (...args: unknown[]) => clockMock(...args),
    discovery: (...args: unknown[]) => discoveryMock(...args),
    dailyListening: (...args: unknown[]) => dailyMock(...args),
    lifeSoundtrack: () => Promise.resolve({ groups: [], gap_minutes: 30 }),
    genreStream: () => Promise.resolve({ bucket: 'week', genres: [], buckets: [], plays: 0, plays_with_genres: 0 }),
    genres: () => Promise.resolve([]),
  },
}));
vi.mock('../../../client/src/api/client', () => ({
  stats: { earliestDates: () => Promise.resolve({ music: '2020-01-01' }) },
}));

const agg = (name: string, plays: number, extra: object = {}) => ({
  name, plays, listened_seconds: plays * 100,
  first_played_at: '2024-01-01T00:00:00Z', last_played_at: '2024-01-02T00:00:00Z', ...extra,
});

const STATS = {
  totals: { scrobbles: 321, listened_seconds: 7200, unique_artists: 40, unique_tracks: 99 },
  top_songs: Array.from({ length: 12 }, (_, i) => agg(`Song ${i + 1}`, 50 - i, { artists: ['Someone'] })),
  top_artists: [agg('Khruangbin', 30)],
  top_albums: [],
  top_genres: [{ name: 'psychedelic rock', plays: 30, listened_seconds: 3000, artists: 1 }],
};

function renderTab() {
  return render(
    <MemoryRouter>
      <MusicTab userId="u1" />
    </MemoryRouter>,
  );
}

describe('MusicTab', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music');
    statsMock.mockResolvedValue(STATS);
    clockMock.mockReset().mockResolvedValue([]);
    discoveryMock.mockReset().mockResolvedValue({ bucket: 'week', buckets: [], totals: { plays: 0, new_plays: 0, new_songs: 0, new_artists: 0 } });
    dailyMock.mockReset().mockResolvedValue({ days: [], listening_days: 0, longest_streak: 0, current_streak: 0 });
    libraryMock.mockResolvedValue({ rows: [], total: 0 });
  });
  afterEach(() => {
    cleanup();
    statsMock.mockReset();
    libraryMock.mockReset();
  });

  it('loads the current month by default and shows totals and top lists', async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText('321')).toBeTruthy());
    const [from, to] = statsMock.mock.calls[0];
    const month = new Date().toISOString().slice(0, 7);
    expect(from).toBe(`${month}-01`);
    expect(to?.startsWith(month)).toBe(true);
    expect(screen.getByText('2h')).toBeTruthy();
    expect(screen.getByText('Top songs')).toBeTruthy();
    expect(screen.getByText('Top artists')).toBeTruthy();
    expect(screen.getByText('Top albums')).toBeTruthy();
    expect(screen.getByText('Top genres')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'psychedelic rock' }).getAttribute('href')).toBe('/music/genre?name=psychedelic+rock');
    expect(screen.getByRole('region', { name: 'Genres over time' })).toBeTruthy();
    expect(screen.getByText('Khruangbin')).toBeTruthy();
    expect(screen.getByText('Nothing played in this period.')).toBeTruthy();
  });

  it('links top artists, songs and albums to their own pages', async () => {
    statsMock.mockResolvedValue({
      ...STATS,
      top_songs: [agg('Song 1', 9, { artists: ['Khruangbin'], song_key: 'song 1|khruangbin' })],
      top_albums: [agg('Mowgli\'s Road', 4, { artists: ['Khruangbin'], album_ref: 'mowglis road|khruangbin' })],
    });
    renderTab();
    await waitFor(() => screen.getByText('Song 1'));
    expect(screen.getAllByRole('link', { name: 'Khruangbin' })[0].getAttribute('href')).toBe('/music/artist?name=Khruangbin');
    expect(screen.getByRole('link', { name: 'Song 1' }).getAttribute('href')).toBe('/music/song?key=song+1%7Ckhruangbin');
    expect(screen.getByRole('link', { name: "Mowgli's Road" }).getAttribute('href')).toBe('/music/album?ref=mowglis+road%7Ckhruangbin');
  });

  describe('making a list from the top songs and albums', () => {
    const rows = (n: number, albums = false) =>
      Array.from({ length: n }, (_, i) =>
        agg(`${albums ? 'Album' : 'Song'} ${i + 1}`, 50 - i, {
          artists: ['Someone'], album_ref: `album ${i + 1}|someone`, ...(albums ? {} : { song_key: `song ${i + 1}\u001fsomeone` }),
        }));
    beforeEach(() => {
      listsData = [];
      createFromMock.mockImplementation(async () => {
        listsData = [{ id: 'new1', name: 'Made', created_at: '2023-07-01T00:00:00Z', updated_at: '2023-07-01T00:00:00Z', item_count: 1, covers: [], items: [] }];
        return { id: 'new1', name: 'Made', added: 10 };
      });
      statsMock.mockResolvedValue({ ...STATS, top_songs: rows(12), top_albums: rows(3, true) });
    });
    afterEach(() => {
      createFromMock.mockReset();
      listsData = [];
    });

    it('makes a list of the songs shown, named for the month, then opens it', async () => {
      const user = userEvent.setup();
      window.history.replaceState(null, '', '/profile?tab=plugin:music&musicMonth=2023-06&musicPeriod=single');
      renderTab();
      await waitFor(() => screen.getByText('Song 1'));
      await user.click(screen.getByRole('button', { name: 'Make a list from these 10 songs' }));
      await waitFor(() => expect(createFromMock).toHaveBeenCalledTimes(1));
      const [name, items] = createFromMock.mock.calls[0];
      expect(name).toBe('2023-06 Most Listened Songs');
      expect(items).toHaveLength(10);
      expect(items[0]).toEqual({ kind: 'song', song_key: 'song 1\u001fsomeone', album_ref: 'album 1|someone' });
      expect(items[9].song_key).toBe('song 10\u001fsomeone');
      // Straight to the new list.
      const params = new URLSearchParams(window.location.search);
      expect([params.get('musicSection'), params.get('musicList')]).toEqual(['lists', 'new1']);
      expect(await screen.findByRole('region', { name: 'Music lists' })).toBeTruthy();
    });

    it('includes the rows revealed by "Show more"', async () => {
      const user = userEvent.setup();
      renderTab();
      await waitFor(() => screen.getByText('Song 1'));
      await user.click(screen.getByRole('button', { name: 'Show 2 more' }));
      await user.click(screen.getByRole('button', { name: 'Make a list from these 12 songs' }));
      await waitFor(() => expect(createFromMock).toHaveBeenCalled());
      expect(createFromMock.mock.calls[0][1]).toHaveLength(12);
    });

    it('makes an album list with the all-time name, and artists get no button', async () => {
      const user = userEvent.setup();
      window.history.replaceState(null, '', '/profile?tab=plugin:music&musicPeriod=all');
      renderTab();
      await waitFor(() => screen.getByText('Album 1'));
      expect(screen.queryByRole('button', { name: /Make a list from these \d+ artists/ })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Make a list from these 3 albums' }));
      await waitFor(() => expect(createFromMock).toHaveBeenCalled());
      const [name, items] = createFromMock.mock.calls[0];
      expect(name).toBe('All Time Most Listened Albums');
      expect(items).toEqual([1, 2, 3].map((i) => ({ kind: 'album', album_ref: `album ${i}|someone` })));
    });

    it('shows why it failed and stays put', async () => {
      const user = userEvent.setup();
      createFromMock.mockRejectedValue(new Error('None of those songs or albums were found'));
      renderTab();
      await waitFor(() => screen.getByText('Song 1'));
      await user.click(screen.getByRole('button', { name: 'Make a list from these 10 songs' }));
      expect(await screen.findByText('None of those songs or albums were found')).toBeTruthy();
      expect(new URLSearchParams(window.location.search).has('musicList')).toBe(false);
    });

    it('has nothing to make a list from when nothing was played', async () => {
      statsMock.mockResolvedValue({ ...STATS, top_songs: [], top_albums: [] });
      renderTab();
      await waitFor(() => screen.getByText('Scrobbles'));
      const buttons = screen.getAllByRole('button', { name: /Make a list from these 0/ });
      expect(buttons).toHaveLength(2); // songs and albums
      expect(buttons.every((b) => b.hasAttribute('disabled'))).toBe(true);
    });
  });

  describe('subtabs', () => {
    it('opens on Overview with the period selector, and the other subtabs have none', async () => {
      const user = userEvent.setup();
      renderTab();
      await waitFor(() => screen.getByText('321'));
      expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: /^All$/ })).toBeTruthy();
      expect(new URLSearchParams(window.location.search).has('musicSection')).toBe(false); // the default stays out of the URL

      await user.click(screen.getByRole('button', { name: 'Library' }));
      await screen.findByLabelText('Filter library');
      expect(screen.queryByRole('button', { name: /^All$/ })).toBeNull();
      expect(screen.queryByText('Scrobbles')).toBeNull();
      expect(new URLSearchParams(window.location.search).get('musicSection')).toBe('library');

      await user.click(screen.getByRole('button', { name: 'Lists' }));
      await screen.findByRole('region', { name: 'Music lists' });
      expect(screen.queryByLabelText('Filter library')).toBeNull();
      expect(screen.queryByRole('button', { name: /^All$/ })).toBeNull();
      expect(new URLSearchParams(window.location.search).get('musicSection')).toBe('lists');
    });

    it('opens the subtab named in the URL, and clears library filters when leaving the Library', async () => {
      const user = userEvent.setup();
      window.history.replaceState(null, '', '/profile?tab=plugin:music&musicSection=library&q=Soma&musicView=albums');
      renderTab();
      expect(((await screen.findByLabelText('Filter library')) as HTMLInputElement).value).toBe('Soma');
      await user.click(screen.getByRole('button', { name: 'Lists' }));
      const params = new URLSearchParams(window.location.search);
      expect([params.get('musicSection'), params.has('q'), params.has('musicView')]).toEqual(['lists', false, false]);
    });

    it('follows back and forward', async () => {
      renderTab();
      await waitFor(() => screen.getByText('321'));
      window.history.pushState(null, '', '/profile?tab=plugin:music&musicSection=lists');
      window.dispatchEvent(new PopStateEvent('popstate'));
      await screen.findByRole('region', { name: 'Music lists' });
      window.history.pushState(null, '', '/profile?tab=plugin:music');
      window.dispatchEvent(new PopStateEvent('popstate'));
      await screen.findByText('Top songs');
    });
  });

  it('collapses long lists and expands them on request', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => screen.getByText('Song 1'));
    expect(screen.queryByText('Song 11')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(screen.getByText('Song 12')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.queryByText('Song 11')).toBeNull();
  });

  it('refetches stats for a new period, and keeps the tab in the URL', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => screen.getByText('321'));
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('plugin:music');
    await user.click(screen.getByRole('button', { name: /^All$/ }));
    await waitFor(() => expect(statsMock).toHaveBeenLastCalledWith(undefined, undefined));
    expect(new URLSearchParams(window.location.search).get('musicPeriod')).toBe('all');
  });

  it('restores the period from the URL', async () => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music&musicMonth=2023-06&musicPeriod=single');
    renderTab();
    await waitFor(() => expect(statsMock).toHaveBeenCalledWith('2023-06-01', '2023-06-30'));
    // The charts follow the same period; the calendar shows its year.
    await waitFor(() => expect(clockMock).toHaveBeenCalledWith('2023-06-01', '2023-06-30'));
    expect(discoveryMock).toHaveBeenCalledWith('2023-06-01', '2023-06-30');
    expect(dailyMock).toHaveBeenCalledWith(2023, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('shows zeros when stats fail to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    statsMock.mockRejectedValue(new Error('boom'));
    renderTab();
    await waitFor(() => expect(screen.getByText('Scrobbles')).toBeTruthy());
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });
});
