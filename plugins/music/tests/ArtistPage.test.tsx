import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArtistPage from '../ui/pages/ArtistPage';
import type { ArtistDetail } from '../ui/types';

const artistMock = vi.fn();
const tiesMock = vi.fn();
vi.mock('../ui/api', () => ({
  // Spotify isn't set up: its buttons and the Playlists subtab stay hidden.
  spotify: { status: () => Promise.resolve({ configured: false, connected: false }) },
  music: {
    artist: (...a: unknown[]) => artistMock(...a),
    ties: (...a: unknown[]) => tiesMock(...a),
    lists: () => Promise.resolve([]),
  },
  albumArtUrl: (id: string) => `/art/${id}`,
}));

const songs = Array.from({ length: 20 }, (_, i) => ({
  song_key: `s${i}|khruangbin`, name: `Song ${i}`, artists: i === 0 ? ['Khruangbin', 'Leon Bridges'] : ['Khruangbin'],
  album_ref: null, art_id: null, plays: 40 - i, last_played_at: '2024-03-01T00:00:00Z',
}));

const ARTIST: ArtistDetail = {
  name: 'Khruangbin', plays: 500, listened_seconds: 90_000, first_played_at: '2020-01-01T00:00:00Z', last_played_at: '2024-03-01T00:00:00Z',
  unique_songs: 20, rank: 2, artists_total: 300,
  daily: [{ date: '2020-01-01', plays: 300 }, { date: '2024-03-01', plays: 200 }],
  series: {
    bands: [{ key: 's0|khruangbin', name: 'Song 0', artists: ['Khruangbin'], plays: 40, daily: [{ date: '2020-01-01', plays: 40 }] }],
    other: { plays: 460, count: 19, daily: [{ date: '2020-01-01', plays: 260 }, { date: '2024-03-01', plays: 200 }] },
  },
  clock: [{ dow: 1, hour: 9, plays: 500, seconds: 90_000 }],
  songs,
  albums: [{ album_ref: 'con todo el mundo|khruangbin', name: 'Con Todo El Mundo', art_id: 'a1', plays: 300, unique_tracks: 10, last_played_at: '2024-03-01T00:00:00Z' }],
  genres: { genres: ['psychedelic rock'], catalog_genres: ['psychedelic rock'], edited: false, lookup: 'found' },
  play_genres: [{ name: 'psychedelic rock', plays: 500 }],
};

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/music/artist${search}`]}>
      <ArtistPage />
    </MemoryRouter>,
  );

describe('ArtistPage', () => {
  beforeEach(() => {
    artistMock.mockResolvedValue(ARTIST);
    tiesMock.mockResolvedValue({ gap_minutes: 30, companion: [], place: [], mood: [] });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the artist\'s totals, rank, songs and albums, and titles the tab', async () => {
    renderAt('?name=Khruangbin');
    expect(await screen.findByRole('heading', { name: 'Khruangbin' })).toBeTruthy();
    expect(artistMock).toHaveBeenCalledWith('Khruangbin');
    expect(document.body.textContent).toContain('500 plays');
    expect(document.body.textContent).toContain('of 300 artists');
    // The title is set in an effect, which can run just after the heading paints.
    await waitFor(() => expect(document.title).toContain('Khruangbin'));
    const list = within(screen.getByRole('list', { name: 'Songs' }));
    expect(list.getByRole('link', { name: 'Song 0' }).getAttribute('href')).toBe('/music/song?key=s0%7Ckhruangbin');
    // Other credits link to their own pages.
    expect(list.getByRole('link', { name: 'Leon Bridges' }).getAttribute('href')).toBe('/music/artist?name=Leon+Bridges');
    expect(within(screen.getByRole('list', { name: 'Albums' })).getByRole('link', { name: /Con Todo El Mundo/ }).getAttribute('href')).toBe(
      '/music/album?ref=con+todo+el+mundo%7Ckhruangbin',
    );
    expect(screen.getByRole('img', { name: 'Plays per month by song' })).toBeTruthy();
    expect(screen.getByText('Plays per month of the 1 most played songs, 8% of all plays.')).toBeTruthy();
    expect(screen.getByText('Other songs, not drawn: 460 plays of 19 more songs.')).toBeTruthy();
    expect(tiesMock).toHaveBeenCalledWith({ artist: 'Khruangbin' });
  });

  it('shows the top songs first, and the rest on request', async () => {
    const user = userEvent.setup();
    renderAt('?name=Khruangbin');
    const list = await screen.findByRole('list', { name: 'Songs' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(15);
    await user.click(screen.getByRole('button', { name: 'Show 5 more' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(20);
  });

  it('says so without an artist, and for one never played', async () => {
    renderAt('');
    expect(screen.getByText('No artist was given.')).toBeTruthy();
    cleanup();
    artistMock.mockRejectedValue(new Error('404'));
    renderAt('?name=Nobody');
    expect(await screen.findByText("Couldn't load this artist.")).toBeTruthy();
  });
});
