import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GenrePage from '../ui/pages/GenrePage';
import type { GenreDetail } from '../ui/types';

const genreMock = vi.fn();
const tiesMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: {
    genre: (...a: unknown[]) => genreMock(...a),
    ties: (...a: unknown[]) => tiesMock(...a),
    lists: () => Promise.resolve([]),
  },
  albumArtUrl: (id: string) => `/art/${id}`,
}));

const GENRE: GenreDetail = {
  name: 'progressive trance', plays: 120, listened_seconds: 36_000,
  first_played_at: '2021-01-01T00:00:00Z', last_played_at: '2024-03-01T00:00:00Z',
  unique_songs: 40, unique_artists: 9, rank: 3, genres_total: 55,
  daily: [{ date: '2021-01-01', plays: 100 }, { date: '2024-03-01', plays: 20 }],
  clock: [{ dow: 1, hour: 20, plays: 120, seconds: 36_000 }],
  artists: [{ name: 'Above & Beyond', plays: 80 }, { name: 'Richard Bedford', plays: 5 }],
  songs: [{ song_key: 'sun & moon|above & beyond', name: 'Sun & Moon', artists: ['Above & Beyond', 'Richard Bedford'], album_ref: null, art_id: null, plays: 30, last_played_at: '2024-03-01T00:00:00Z' }],
  albums: [{ album_ref: 'group therapy|above & beyond', name: 'Group Therapy', art_id: null, plays: 90, unique_tracks: 12, last_played_at: '2024-03-01T00:00:00Z' }],
  related: [{ name: 'trance', plays: 100 }],
};

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/music/genre${search}`]}>
      <GenrePage />
    </MemoryRouter>,
  );

describe('GenrePage', () => {
  beforeEach(() => {
    genreMock.mockResolvedValue(GENRE);
    tiesMock.mockResolvedValue({ gap_minutes: 30, companion: [], place: [], mood: [] });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the genre’s totals, rank, artists, songs, albums and related genres', async () => {
    renderAt('?name=Progressive%20Trance');
    expect(await screen.findByRole('heading', { name: 'progressive trance' })).toBeTruthy();
    expect(genreMock).toHaveBeenCalledWith('progressive trance');
    expect(document.body.textContent).toContain('120 plays · 40 songs · 9 artists');
    expect(document.body.textContent).toContain('of 55 genres');
    expect(document.title).toContain('progressive trance');
    expect(within(screen.getByRole('list', { name: 'Artists' })).getByRole('link', { name: 'Above & Beyond' }).getAttribute('href')).toBe(
      '/music/artist?name=Above+%26+Beyond',
    );
    expect(within(screen.getByRole('list', { name: 'Songs' })).getByRole('link', { name: 'Sun & Moon' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Genres on the same plays' })).getByRole('link', { name: 'trance' }).getAttribute('href')).toBe(
      '/music/genre?name=trance',
    );
    expect(screen.getByRole('link', { name: 'Show in library' }).getAttribute('href')).toBe(
      '/profile?tab=plugin%3Amusic&musicSection=library&genre=progressive+trance',
    );
    expect(tiesMock).toHaveBeenCalledWith({ genre: 'progressive trance' });
  });

  it('says so without a genre, for one nothing has, and when loading fails', async () => {
    renderAt('');
    expect(screen.getByText('No genre was given.')).toBeTruthy();
    cleanup();
    genreMock.mockRejectedValue(Object.assign(new Error('No plays with that genre'), { status: 404 }));
    renderAt('?name=polka');
    expect(await screen.findByText(/None of your plays have the genre “polka”/)).toBeTruthy();
    cleanup();
    genreMock.mockRejectedValue(Object.assign(new Error('Failed'), { status: 500 }));
    renderAt('?name=polka');
    expect(await screen.findByText("Couldn't load this genre.")).toBeTruthy();
  });
});
