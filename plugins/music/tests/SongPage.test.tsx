import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SongPage from '../ui/pages/SongPage';
import type { SongDetail, SongPlay } from '../ui/types';

const songMock = vi.fn();
const songPlaysMock = vi.fn();
const tiesMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: {
    song: (...a: unknown[]) => songMock(...a),
    songPlays: (...a: unknown[]) => songPlaysMock(...a),
    ties: (...a: unknown[]) => tiesMock(...a),
    lists: () => Promise.resolve([]),
  },
  albumArtUrl: (id: string) => `/art/${id}`,
}));

const SONG: SongDetail = {
  name: 'One More Time', artists: ['Daft Punk', 'Romanthony'], album_ref: 'discovery|daft punk', art_id: 'a1',
  plays: 3, listened_seconds: 600, first_played_at: '2024-01-05T12:00:00Z', last_played_at: '2024-03-02T12:00:00Z',
  rank: 3, songs_total: 1200,
  daily: [{ date: '2024-01-05', plays: 2 }, { date: '2024-03-02', plays: 1 }],
  clock: [{ dow: 5, hour: 12, plays: 2, seconds: 400 }, { dow: 6, hour: 12, plays: 1, seconds: 200 }],
  albums: [{ album_ref: 'discovery|daft punk', album: 'Discovery', art_id: 'a1', plays: 3 }],
  genres: [{ name: 'french house', plays: 3 }, { name: 'disco', plays: 1 }],
};

const play = (id: string, played_at: string, extra: Partial<SongPlay> = {}): SongPlay => ({
  id, played_at, timezone: 'America/Chicago', album: 'Discovery', album_ref: 'r', art_id: null,
  track_length: 201, listened_for: null, source: 'lastfm', session_id: null, session_date: null, ...extra,
});

function Where() {
  const { search } = useLocation();
  return <p data-testid="where">{search}</p>;
}

const renderPage = (search = '?key=omt%7Cdaft+punk') =>
  render(
    <MemoryRouter initialEntries={[`/music/song${search}`]}>
      <Routes>
        <Route path="/music/song" element={<><SongPage /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );

const lastPlaysCall = () => songPlaysMock.mock.calls[songPlaysMock.mock.calls.length - 1];
const params = () => new URLSearchParams(screen.getByTestId('where').textContent ?? '');

describe('SongPage', () => {
  beforeEach(() => {
    songMock.mockResolvedValue(SONG);
    songPlaysMock.mockResolvedValue({
      rows: [play('p1', '2024-03-02T03:30:00Z', { session_id: 's1', session_date: '2024-03-01' }), play('p2', '2024-01-05T12:00:00Z')],
      total: 3,
    });
    tiesMock.mockResolvedValue({
      gap_minutes: 30,
      companion: [{ key: 'Sam', label: 'Sam', plays: 2, checkins: 1 }],
      place: [{ key: 'c1', label: 'Gym', plays: 1, checkins: 1 }],
      mood: [{ key: '4', label: '4', plays: 1, checkins: 1 }],
    });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the song, its artists and album, rank and every play, and titles the tab', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /One More Time/ })).toBeTruthy();
    expect(songMock).toHaveBeenCalledWith('omt|daft punk');
    expect(screen.getByRole('link', { name: 'Romanthony' }).getAttribute('href')).toBe('/music/artist?name=Romanthony');
    expect(screen.getByRole('link', { name: 'Discovery' }).getAttribute('href')).toBe('/music/album?ref=discovery%7Cdaft+punk');
    expect(document.body.textContent).toContain('#3');
    expect(document.body.textContent).toContain('of 1,200 songs');
    expect(document.title).toContain('One More Time');
    await waitFor(() => expect(screen.getByText('Mar 1, 2024')).toBeTruthy());
    expect(songPlaysMock).toHaveBeenCalledWith('omt|daft punk', { limit: 100, from: undefined, to: undefined });
    const plays = within(screen.getByRole('list', { name: 'Plays' }));
    expect(plays.getAllByRole('link').some((a) => a.getAttribute('href') === '/music/plays/p1')).toBe(true);
  });

  it('shows when it\'s played, and the companions, places and moods it\'s played around', async () => {
    renderPage();
    await screen.findByRole('heading', { name: /One More Time/ });
    expect(screen.getByRole('region', { name: 'When you play it' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Listening by hour of day' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Listening by weekday' })).toBeTruthy();
    expect(tiesMock).toHaveBeenCalledWith({ songKey: 'omt|daft punk' });
    expect((await screen.findByRole('link', { name: 'Sam' })).getAttribute('href')).toBe('/?companion=Sam');
    expect(screen.getByRole('link', { name: 'Gym' }).getAttribute('href')).toBe('/?category=Gym');
  });

  it('narrows the plays to a clicked month, then to one of its weeks, and back to every play', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /One More Time/ });
    await user.click(screen.getByRole('button', { name: 'Jan 2024: 2 plays. Show these plays' }));
    expect([params().get('period'), params().get('month')]).toEqual(['single', '2024-01']);
    await waitFor(() => expect(lastPlaysCall()[1]).toMatchObject({ from: '2024-01-01', to: '2024-01-31' }));
    expect(screen.getByRole('heading', { name: /Plays · January 2024/ })).toBeTruthy();

    const weeks = within(screen.getByRole('group', { name: 'Weeks of Jan 2024' }));
    await user.click(weeks.getByRole('button', { name: 'Jan 1 – 7 · 2' }));
    expect([params().get('period'), params().get('week')]).toEqual(['weekly', '2024-01-07']);
    await waitFor(() => expect(lastPlaysCall()[1]).toMatchObject({ from: '2024-01-01', to: '2024-01-07' }));

    await user.click(screen.getByRole('button', { name: /Show every play/ }));
    expect(params().get('period')).toBeNull();
    await waitFor(() => expect(lastPlaysCall()[1]).toMatchObject({ from: undefined, to: undefined }));
  });

  it('groups the chart by week, month or year, kept in the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('heading', { name: /One More Time/ });
    expect(screen.getByRole('group', { name: 'Plays per month from Jan 2024 to Mar 2024' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Year' }));
    expect(params().get('bucket')).toBe('year');
    expect(screen.getByRole('group', { name: 'Plays per year from 2024 to 2024' })).toBeTruthy();
    // A year bar narrows the plays to that year.
    await user.click(screen.getByRole('button', { name: '2024: 3 plays. Show these plays' }));
    await waitFor(() => expect(lastPlaysCall()[1]).toMatchObject({ from: '2024-01-01', to: '2024-12-31' }));
  });

  it('opens with the period in the URL', async () => {
    renderPage('?key=k&period=single&month=2024-03');
    await screen.findByRole('heading', { name: /One More Time/ });
    await waitFor(() => expect(lastPlaysCall()[1]).toMatchObject({ from: '2024-03-01', to: '2024-03-31' }));
  });

  it('says so without a song, and for one that is gone', async () => {
    renderPage('');
    expect(screen.getByText('No song was given.')).toBeTruthy();
    cleanup();
    songMock.mockRejectedValue(new Error('404'));
    renderPage();
    expect(await screen.findByText("Couldn't load this song.")).toBeTruthy();
  });

  it('shows the genres of its plays, each opening its page', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Genres' });
    expect(within(list).getByRole('link', { name: 'french house' }).getAttribute('href')).toBe('/music/genre?name=french+house');
    expect(within(list).getByRole('link', { name: 'disco' })).toBeTruthy();
  });
});
