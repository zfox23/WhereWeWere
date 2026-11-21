import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { MusicLibrarySection } from '../ui/MusicLibrarySection';
import type { MusicAggregate, MusicLibraryView } from '../ui/types';

const libraryMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: {
    library: (...args: unknown[]) => libraryMock(...args),
    lists: () => Promise.resolve([]),
  },
  albumArtUrl: (id: string) => `/art/${id}`,
}));

const song = (name: string, artists: string[], plays: number, last: string, album: string | null = null): MusicAggregate => ({
  name, artists, album, plays, listened_seconds: plays * 200,
  first_played_at: '2024-01-01T00:00:00Z', last_played_at: last,
});

const SONGS = [
  song('Alpha', ['Zed'], 5, '2024-03-01T00:00:00Z', 'First Album'),
  song('Bravo', ['Amy'], 9, '2024-02-01T00:00:00Z'),
  song('Charlie', ['Bob'], 9, '2024-04-01T00:00:00Z'),
];

function titles(): string[] {
  const body = screen.getAllByRole('rowgroup')[1];
  return within(body).getAllByRole('row').map((r) => r.querySelector('td')?.textContent ?? '');
}

function renderSection(props: { from?: string; to?: string } = {}) {
  return render(
    <MemoryRouter>
      <MusicLibrarySection from={props.from ?? ''} to={props.to ?? ''} />
    </MemoryRouter>,
  );
}

function BackProbe() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Back</button>;
}

const page = (rows: MusicAggregate[], total = rows.length) => Promise.resolve({ rows, total });
const lastCall = () => libraryMock.mock.calls[libraryMock.mock.calls.length - 1];

describe('MusicLibrarySection', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music');
    libraryMock.mockReset();
    libraryMock.mockImplementation((view: MusicLibraryView) =>
      view === 'songs' ? page(SONGS) : page([song('Zed', [], 5, '2024-03-01T00:00:00Z')]),
    );
  });
  afterEach(cleanup);

  it('asks the server for the first page, most played first, and shows the rows as returned', async () => {
    renderSection({ from: '2024-01-01', to: '2024-03-31' });
    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']));
    expect(libraryMock).toHaveBeenCalledWith('songs', '2024-01-01', '2024-03-31', { q: '', sort: 'plays', dir: 'desc', limit: 100 });
    expect(screen.getByText('Showing 3 of 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('omits the range for all time', async () => {
    renderSection();
    await waitFor(() => expect(libraryMock).toHaveBeenCalledWith('songs', undefined, undefined, expect.any(Object)));
  });

  it('sorts on the server when a column is clicked, and flips direction on a second click', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(titles()).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Title' }));
    await waitFor(() => expect(lastCall()[3]).toMatchObject({ sort: 'name', dir: 'asc' }));
    await user.click(screen.getByRole('button', { name: 'Title' }));
    await waitFor(() => expect(lastCall()[3]).toMatchObject({ sort: 'name', dir: 'desc' }));
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('name');
    // Descending is the default direction, so it stays out of the URL.
    expect(new URLSearchParams(window.location.search).has('dir')).toBe(false);
  });

  it('searches on the server once typing pauses, not on every keystroke', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(titles()).toHaveLength(3));
    libraryMock.mockClear();
    libraryMock.mockImplementation(() => page([SONGS[0]], 1));
    await user.type(screen.getByLabelText('Filter library'), 'first album');
    await waitFor(() => expect(libraryMock).toHaveBeenCalled());
    expect(libraryMock).toHaveBeenCalledTimes(1);
    expect(lastCall()[3]).toMatchObject({ q: 'first album' });
    await waitFor(() => expect(titles()).toEqual(['Alpha']));
    libraryMock.mockImplementation(() => page([], 0));
    await user.clear(screen.getByLabelText('Filter library'));
    await user.type(screen.getByLabelText('Filter library'), 'zzz');
    expect(await screen.findByText('Nothing matches your filter.')).toBeTruthy();
  });

  it('loads the next page after the rows it already has, and says how many there are', async () => {
    const user = userEvent.setup();
    libraryMock.mockImplementationOnce(() => page(SONGS.slice(0, 2), 3));
    renderSection();
    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Bravo']));
    expect(screen.getByText('Showing 2 of 3')).toBeTruthy();
    libraryMock.mockImplementationOnce(() => page(SONGS.slice(2), 3));
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']));
    expect(lastCall()[3]).toMatchObject({ offset: 2, limit: 100 });
    expect(screen.getByText('Showing 3 of 3')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('switches view and refetches', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(titles()).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Artists' }));
    await waitFor(() => expect(lastCall()[0]).toBe('artists'));
    await waitFor(() => expect(titles()).toEqual(['Zed']));
    expect(new URLSearchParams(window.location.search).get('musicView')).toBe('artists');
  });

  it('restores state from the URL and sends it to the server', async () => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music&musicView=songs&sort=name&dir=asc&q=a');
    renderSection();
    await waitFor(() => expect(libraryMock).toHaveBeenCalledWith('songs', undefined, undefined, { q: 'a', sort: 'name', dir: 'asc', limit: 100 }));
    expect((screen.getByLabelText('Filter library') as HTMLInputElement).value).toBe('a');
  });

  it('keeps the URL clean while everything is at its default', async () => {
    renderSection();
    await waitFor(() => expect(titles()).toHaveLength(3));
    expect(window.location.search).toBe('?tab=plugin:music');
  });

  it('shows an empty state and an error state', async () => {
    libraryMock.mockImplementationOnce(() => page([]));
    renderSection();
    await waitFor(() => expect(screen.getByText('No music played yet.')).toBeTruthy());
    cleanup();
    libraryMock.mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderSection();
    await waitFor(() => expect(screen.getByText("Couldn't load the music library.")).toBeTruthy());
  });

  it('links titles and the play count to the song\'s page, artists to theirs', async () => {
    libraryMock.mockImplementation(() =>
      page([{ ...song('Bravo', ['Amy', 'Bob'], 9, '2024-02-01T00:00:00Z'), song_key: 'bravo|amy' }]),
    );
    renderSection();
    await waitFor(() => expect(titles()).toEqual(['Bravo']));
    expect(screen.getByRole('link', { name: 'Bravo' }).getAttribute('href')).toBe('/music/song?key=bravo%7Camy');
    expect(screen.getByLabelText('9 plays of Bravo: show every play').closest('a')?.getAttribute('href')).toBe('/music/song?key=bravo%7Camy');
    expect(screen.getByRole('link', { name: 'Bob' }).getAttribute('href')).toBe('/music/artist?name=Bob');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('links an artist row to the artist\'s page', async () => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music&musicView=artists');
    renderSection();
    expect((await screen.findByRole('link', { name: 'Zed' })).getAttribute('href')).toBe('/music/artist?name=Zed');
  });

  it('comes back from a song\'s page with the rows that were loaded, refreshed in one request', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...song(`Song ${i}`, ['A'], 200 - i, '2024-02-01T00:00:00Z'), song_key: `k${i}` }));
    const more = [{ ...song('Song 100', ['A'], 1, '2024-02-01T00:00:00Z'), song_key: 'k100' }];
    libraryMock.mockImplementation((_v: string, _f: unknown, _t: unknown, opts: { offset?: number; limit?: number }) =>
      opts.offset ? page(more, 101) : page(opts.limit === 101 ? [...many, ...more] : many, 101),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<MusicLibrarySection from="" to="" />} />
          <Route path="/music/song" element={<BackProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(titles()).toHaveLength(100));
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(titles()).toHaveLength(101));
    await user.click(screen.getByRole('link', { name: 'Song 100' }));
    libraryMock.mockClear();
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    // All 101 rows at once, without waiting on the server…
    expect(titles()).toHaveLength(101);
    // …then refreshed in place with one request for as many rows.
    await waitFor(() => expect(libraryMock).toHaveBeenCalledTimes(1));
    expect(lastCall()[3]).toMatchObject({ limit: 101 });
    expect(titles()).toHaveLength(101);
  });

  it('links Last played to its listening session on Home, labelled with that day', async () => {
    libraryMock.mockImplementation(() =>
      page([{ ...song('Bravo', ['Amy'], 9, '2024-02-02T03:00:00Z'), last_session_id: 'sess-1', last_session_date: '2024-02-01' }]),
    );
    function HomeProbe() {
      const loc = useLocation();
      return <p>home {loc.search} {JSON.stringify(loc.state)}</p>;
    }
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<MusicLibrarySection from="" to="" />} />
          <Route path="/" element={<HomeProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: 'Feb 1, 2024' });
    expect(link.getAttribute('href')).toBe('/?from=2024-02-01&to=2024-02-01');
    await user.click(link);
    expect(await screen.findByText('home ?from=2024-02-01&to=2024-02-01 {"focusSession":"sess-1"}')).toBeTruthy();
  });
});
