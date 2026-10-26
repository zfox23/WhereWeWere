import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicTab } from '../ui/MusicTab';

const statsMock = vi.fn();
const libraryMock = vi.fn();
const albumViewMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: {
    stats: (...args: unknown[]) => statsMock(...args),
    library: (...args: unknown[]) => libraryMock(...args),
    lists: () => Promise.resolve([]),
    albumView: (...args: unknown[]) => albumViewMock(...args),
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
    libraryMock.mockResolvedValue([]);
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
    expect(screen.getByText('Khruangbin')).toBeTruthy();
    expect(screen.getByText('Nothing played in this period.')).toBeTruthy();
  });

  it('jumps to the library filtered to a clicked artist, song or album, keeping the period', async () => {
    const user = userEvent.setup();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.history.replaceState(null, '', '/profile?tab=plugin:music&musicPeriod=twelve&sort=plays&dir=asc');
    statsMock.mockResolvedValue({
      ...STATS,
      top_albums: [agg('Mowgli\'s Road', 4, { artists: ['Khruangbin'], album_ref: 'mowglis road|khruangbin' })],
    });
    renderTab();
    await waitFor(() => screen.getByText('Song 1'));

    await user.click(screen.getByRole('link', { name: 'Khruangbin' }));
    let params = new URLSearchParams(window.location.search);
    expect([params.get('musicView'), params.get('q'), params.get('musicPeriod')]).toEqual(['artists', 'Khruangbin', 'twelve']);
    expect(params.has('sort') && params.has('dir')).toBe(false);
    expect((screen.getByLabelText('Filter library') as HTMLInputElement).value).toBe('Khruangbin');
    expect(libraryMock).toHaveBeenLastCalledWith('artists', expect.any(String), expect.any(String));

    await user.click(screen.getByRole('link', { name: 'Song 3' }));
    params = new URLSearchParams(window.location.search);
    expect([params.get('musicView'), params.get('q')]).toEqual([null, 'Song 3']); // songs is the default view
    expect((screen.getByLabelText('Filter library') as HTMLInputElement).value).toBe('Song 3');

    // An album opens its details instead of filtering, whether or not it has a catalog match.
    albumViewMock.mockResolvedValue({
      album_ref: 'mowglis road|khruangbin', art_id: null, matched: false, title: "Mowgli's Road", artist: 'Khruangbin',
      release_date: null, label: null, plays: 4, listened_seconds: 0, tracks: [],
    });
    await user.click(screen.getByRole('button', { name: "Mowgli's Road" }));
    expect(await screen.findByRole('dialog', { name: "Mowgli's Road by Khruangbin" })).toBeTruthy();
    expect(albumViewMock).toHaveBeenCalledWith({ ref: 'mowglis road|khruangbin', artId: undefined });
    // ...and its "Show in library" filters this page.
    await user.click(screen.getByRole('button', { name: 'Show in library' }));
    params = new URLSearchParams(window.location.search);
    expect([params.get('musicView'), params.get('q')]).toEqual(['albums', "Mowgli's Road"]);
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
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

  it('refetches stats and the library for a new period, and keeps the tab in the URL', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitFor(() => screen.getByText('321'));
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('plugin:music');
    await user.click(screen.getByRole('button', { name: /^All$/ }));
    await waitFor(() => expect(statsMock).toHaveBeenLastCalledWith(undefined, undefined));
    await waitFor(() => expect(libraryMock).toHaveBeenLastCalledWith('songs', undefined, undefined));
    expect(new URLSearchParams(window.location.search).get('musicPeriod')).toBe('all');
  });

  it('restores the period from the URL', async () => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music&musicMonth=2023-06&musicPeriod=single');
    renderTab();
    await waitFor(() => expect(statsMock).toHaveBeenCalledWith('2023-06-01', '2023-06-30'));
  });

  it('shows zeros when stats fail to load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    statsMock.mockRejectedValue(new Error('boom'));
    renderTab();
    await waitFor(() => expect(screen.getByText('Scrobbles')).toBeTruthy());
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });
});
