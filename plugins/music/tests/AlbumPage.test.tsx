import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlbumPage, { releaseDateLabel } from '../ui/pages/AlbumPage';
import { resetMusicLists } from '../ui/useMusicLists';

const albumViewMock = vi.fn();
const setGenresMock = vi.fn();
vi.mock('../ui/api', () => ({
  // Spotify isn't set up: its buttons and the Playlists subtab stay hidden.
  spotify: { status: () => Promise.resolve({ configured: false, connected: false }) },
  albumArtUrl: (id: string, size = 'thumb') => `/art/${id}/${size}`,
  music: {
    albumView: (...a: unknown[]) => albumViewMock(...a),
    lists: async () => [],
    setGenres: (...a: unknown[]) => setGenresMock(...a),
    genres: async () => [{ name: 'trance', plays: 9 }],
  },
}));

const VIEW = {
  album_ref: 'group therapy|above & beyond', art_id: 'a1', matched: true, title: 'Group Therapy', artist: 'Above & Beyond',
  release_date: '2011-06-14', label: 'Anjunabeats', plays: 4, listened_seconds: 900,
  first_played_at: '2024-01-05T12:00:00Z', last_played_at: '2024-03-02T12:00:00Z',
  tracks: [
    { position: 1, title: 'Filaments', artists: ['Above & Beyond'], length: 300, plays: 0, song_key: null },
    { position: 2, title: 'Sun & Moon', artists: ['Above & Beyond'], length: 321, plays: 3, song_key: 'sun & moon|above & beyond' },
    { position: 3, title: 'Alchemy', artists: ['Above & Beyond'], length: 280, plays: 1, song_key: 'alchemy|above & beyond' },
  ],
  daily: [{ date: '2024-01-05', plays: 3 }, { date: '2024-03-02', plays: 1 }],
  other_albums: [
    { album_ref: 'tri-state|above & beyond', name: 'Tri-State', art_id: null, plays: 7, unique_tracks: 4, last_played_at: '2024-02-01T00:00:00Z' },
  ],
  genres: { genres: [], catalog_genres: [], edited: false, lookup: 'not_found' },
  artist_genres: ['trance'],
};

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/music/album${search}`]}>
      <AlbumPage />
    </MemoryRouter>,
  );

describe('AlbumPage', () => {
  beforeEach(() => resetMusicLists());
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the cover, release info, totals and the tracklist, and titles the tab', async () => {
    albumViewMock.mockResolvedValue(VIEW);
    renderAt('?ref=group+therapy%7Cabove+%26+beyond');
    expect(await screen.findByRole('heading', { name: /Group Therapy/ })).toBeTruthy();
    expect(albumViewMock).toHaveBeenCalledWith({ ref: 'group therapy|above & beyond', artId: null });
    expect(document.querySelector('img[alt="Group Therapy cover"]')?.getAttribute('src')).toBe('/art/a1/large');
    expect(document.body.textContent).toContain('Jun 14, 2011 · Anjunabeats');
    expect(document.body.textContent).toContain('4 scrobbles');
    expect(document.body.textContent).toContain('first Jan 5, 2024');
    expect(screen.getByRole('button', { name: 'Add album to list' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    // The title is set in an effect, which can run just after the heading paints.
    await waitFor(() => expect(document.title).toContain('Group Therapy'));
  });

  it('links the artist, and each played track to its song page', async () => {
    albumViewMock.mockResolvedValue(VIEW);
    renderAt('?ref=x');
    await screen.findByRole('heading', { name: /Group Therapy/ });
    expect(screen.getByRole('link', { name: 'Above & Beyond' }).getAttribute('href')).toBe('/music/artist?name=Above+%26+Beyond');
    const tracks = within(screen.getByRole('list', { name: 'Tracks' }));
    expect(tracks.getByRole('link', { name: 'Sun & Moon' }).getAttribute('href')).toBe('/music/song?key=sun+%26+moon%7Cabove+%26+beyond');
    // Never played: nothing to open.
    expect(tracks.queryByRole('link', { name: 'Filaments' })).toBeNull();
  });

  it('draws plays over time and the artist\'s other albums', async () => {
    albumViewMock.mockResolvedValue(VIEW);
    renderAt('?ref=x');
    await screen.findByRole('heading', { name: /Group Therapy/ });
    expect(screen.getByRole('group', { name: 'Plays per month from Jan 2024 to Mar 2024' })).toBeTruthy();
    const more = screen.getByRole('region', { name: 'More by Above & Beyond' });
    expect(within(more).getByRole('link', { name: /Tri-State/ }).getAttribute('href')).toBe('/music/album?ref=tri-state%7Cabove+%26+beyond');
  });

  it('opens by cover id when there is no ref', async () => {
    albumViewMock.mockResolvedValue(VIEW);
    renderAt('?art_id=a1');
    await screen.findByRole('heading', { name: /Group Therapy/ });
    expect(albumViewMock).toHaveBeenCalledWith({ ref: null, artId: 'a1' });
  });

  it('says so without an album, and for one that is gone', async () => {
    renderAt('');
    expect(screen.getByText('No album was given.')).toBeTruthy();
    cleanup();
    albumViewMock.mockRejectedValue(new Error('404'));
    renderAt('?ref=nothing%7Cnobody');
    expect(await screen.findByText("Couldn't load this album.")).toBeTruthy();
  });

  it('adds to a list from the page', async () => {
    const user = userEvent.setup();
    albumViewMock.mockResolvedValue(VIEW);
    renderAt('?ref=x');
    await user.click(await screen.findByRole('button', { name: 'Add album to list' }));
    expect(await screen.findByRole('dialog', { name: /Add .* to a list/ })).toBeTruthy();
  });

  it('formats release dates, leaving partial ones as they are', () => {
    expect(releaseDateLabel('2011-06-14')).toBe('Jun 14, 2011');
    expect(releaseDateLabel('2011-06')).toBe('2011-06');
    expect(releaseDateLabel(null)).toBeNull();
  });
});

describe('AlbumPage genres', () => {
  beforeEach(() => resetMusicLists());
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the artist\'s genres while the album has none, and saves the album\'s own', async () => {
    const user = userEvent.setup();
    albumViewMock.mockResolvedValue(VIEW);
    setGenresMock.mockResolvedValue({ genres: ['uplifting trance'], catalog_genres: [], edited: true, lookup: 'not_found' });
    renderAt('?ref=group+therapy%7Cabove+%26+beyond');
    const genres = await screen.findByRole('region', { name: 'Genres' });
    expect(genres.textContent).toContain("Using Above & Beyond's:");
    expect(within(genres).getByRole('link', { name: 'trance' }).getAttribute('href')).toBe('/music/genre?name=trance');
    expect(genres.textContent).toContain('MusicBrainz has no genres for this');

    await user.click(within(genres).getByRole('button', { name: 'Edit genres of this album' }));
    // A typed genre is kept when Save is pressed without Enter.
    await user.type(screen.getByRole('combobox', { name: 'Add a genre' }), 'Uplifting  Trance');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(setGenresMock).toHaveBeenCalledWith('album', 'group therapy|above & beyond', ['uplifting trance']);
    const saved = await screen.findByRole('region', { name: 'Genres' });
    expect(within(saved).getByRole('link', { name: 'uplifting trance' })).toBeTruthy();
    expect(saved.textContent).toContain('Edited by you');
  });

  it('removes genres and goes back to MusicBrainz\'s', async () => {
    const user = userEvent.setup();
    albumViewMock.mockResolvedValue({ ...VIEW, genres: { genres: ['house'], catalog_genres: ['trance'], edited: true, lookup: 'found' } });
    setGenresMock.mockResolvedValue({ genres: ['trance'], catalog_genres: ['trance'], edited: false, lookup: 'found' });
    renderAt('?ref=group+therapy%7Cabove+%26+beyond');
    await user.click(await screen.findByRole('button', { name: 'Edit genres of this album' }));
    await user.click(screen.getByRole('button', { name: 'Remove house' }));
    expect(screen.getByText("With no genres of its own, its plays use the artist's genres.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: "Use MusicBrainz's genres" }));
    expect(setGenresMock).toHaveBeenCalledWith('album', 'group therapy|above & beyond', null);
    expect(await screen.findByText('From MusicBrainz')).toBeTruthy();
  });

  it('has no editor for an artist\'s "Unknown album", only the artist\'s genres', async () => {
    albumViewMock.mockResolvedValue({ ...VIEW, album_ref: '|above & beyond', matched: false, title: 'Unknown album', genres: null });
    renderAt('?ref=%7Cabove+%26+beyond');
    expect(await screen.findByRole('list', { name: "Above & Beyond's genres" })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit genres of this album' })).toBeNull();
  });
});
