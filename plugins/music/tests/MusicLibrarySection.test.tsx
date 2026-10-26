import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MusicLibrarySection } from '../ui/MusicLibrarySection';
import type { MusicAggregate, MusicLibraryView } from '../ui/types';

const libraryMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: { library: (...args: unknown[]) => libraryMock(...args), lists: () => Promise.resolve([]) },
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
});
