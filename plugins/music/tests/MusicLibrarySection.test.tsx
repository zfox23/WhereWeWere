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

describe('MusicLibrarySection', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music');
    libraryMock.mockReset();
    libraryMock.mockImplementation((view: MusicLibraryView) =>
      Promise.resolve(view === 'songs' ? SONGS : [song('Zed', [], 5, '2024-03-01T00:00:00Z')]),
    );
  });
  afterEach(cleanup);

  it('fetches songs for the period and ranks by plays, newest play breaking ties', async () => {
    renderSection({ from: '2024-01-01', to: '2024-03-31' });
    await waitFor(() => expect(titles()).toEqual(['Charlie', 'Bravo', 'Alpha']));
    expect(libraryMock).toHaveBeenCalledWith('songs', '2024-01-01', '2024-03-31');
  });

  it('omits the range for all time', async () => {
    renderSection();
    await waitFor(() => expect(libraryMock).toHaveBeenCalledWith('songs', undefined, undefined));
  });

  it('sorts by a clicked column and flips direction on a second click', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(titles()).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Title' }));
    expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await user.click(screen.getByRole('button', { name: 'Title' }));
    expect(titles()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('name');
    // Descending is the default direction, so it stays out of the URL.
    expect(new URLSearchParams(window.location.search).has('dir')).toBe(false);
  });

  it('filters by title, artist or album', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(titles()).toHaveLength(3));
    await user.type(screen.getByLabelText('Filter library'), 'first album');
    expect(titles()).toEqual(['Alpha']);
    await user.clear(screen.getByLabelText('Filter library'));
    await user.type(screen.getByLabelText('Filter library'), 'amy');
    expect(titles()).toEqual(['Bravo']);
    await user.clear(screen.getByLabelText('Filter library'));
    await user.type(screen.getByLabelText('Filter library'), 'zzz');
    expect(screen.getByText('Nothing matches your filter.')).toBeTruthy();
  });

  it('switches view and refetches', async () => {
    const user = userEvent.setup();
    renderSection();
    await waitFor(() => expect(titles()).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'Artists' }));
    await waitFor(() => expect(libraryMock).toHaveBeenLastCalledWith('artists', undefined, undefined));
    await waitFor(() => expect(titles()).toEqual(['Zed']));
    expect(new URLSearchParams(window.location.search).get('musicView')).toBe('artists');
  });

  it('restores state from the URL', async () => {
    window.history.replaceState(null, '', '/profile?tab=plugin:music&musicView=songs&sort=name&dir=asc&q=a');
    renderSection();
    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Bravo', 'Charlie']));
    expect((screen.getByLabelText('Filter library') as HTMLInputElement).value).toBe('a');
  });

  it('keeps the URL clean while everything is at its default', async () => {
    renderSection();
    await waitFor(() => expect(titles()).toHaveLength(3));
    expect(window.location.search).toBe('?tab=plugin:music');
  });

  it('shows an empty state and an error state', async () => {
    libraryMock.mockResolvedValueOnce([]);
    renderSection();
    await waitFor(() => expect(screen.getByText('No music played in this period.')).toBeTruthy());
    cleanup();
    libraryMock.mockRejectedValueOnce(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderSection();
    await waitFor(() => expect(screen.getByText("Couldn't load the music library.")).toBeTruthy());
  });
});
