import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpotifyButton } from '../ui/SpotifyButton';
import { SpotifyExportButton } from '../ui/SpotifyExportButton';
import { MusicPlaylistsSection, forgottenTracks, sortPlaylists, topArtists } from '../ui/MusicPlaylistsSection';
import { SpotifySettings } from '../ui/SpotifySettings';
import { resetSpotifyStatusCache } from '../ui/useSpotifyStatus';
import type { SpotifyPlaylist, SpotifyPlaylistTrack, SpotifyStatus } from '../ui/types';

const statusMock = vi.fn();
const linkMock = vi.fn();
const playlistsMock = vi.fn();
const playlistMock = vi.fn();
const getExportMock = vi.fn();
const exportListMock = vi.fn();
const saveMock = vi.fn();
const authorizeMock = vi.fn();
vi.mock('../ui/api', () => ({
  spotify: {
    status: () => statusMock(),
    link: (...a: unknown[]) => linkMock(...a),
    playlists: () => playlistsMock(),
    playlist: (...a: unknown[]) => playlistMock(...a),
    coverUrl: (id: string) => `/cover/${id}`,
    getExport: (...a: unknown[]) => getExportMock(...a),
    exportList: (...a: unknown[]) => exportListMock(...a),
    saveCredentials: (...a: unknown[]) => saveMock(...a),
    authorize: () => authorizeMock(),
    disconnect: vi.fn(),
    remove: vi.fn(),
  },
  music: {},
  albumArtUrl: (id: string) => `/art/${id}`,
}));
vi.mock('../../../client/src/api/client', () => ({ jobs: { start: vi.fn(), get: vi.fn() } }));

const STATUS: SpotifyStatus = {
  configured: true,
  connected: true,
  client_id: 'a'.repeat(32),
  display_name: 'Zach',
  spotify_user_id: 'me',
  last_synced_at: '2024-05-01T12:00:00Z',
  last_attempt_at: '2024-05-01T12:00:00Z',
  last_error: null,
  last_summary: { playlists: 2, read: 1, unavailable: 1, tracks: 3 },
  playlists: 2,
  callback_path: '/api/v1/music/spotify/callback',
};

const playlist = (over: Partial<SpotifyPlaylist>): SpotifyPlaylist => ({
  spotify_id: 'p',
  position: 0,
  name: 'P',
  description: null,
  owner_name: 'Zach',
  mine: true,
  has_cover: false,
  total_tracks: 2,
  tracks_available: true,
  last_modified_at: null,
  url: 'https://open.spotify.com/playlist/p',
  plays: 0,
  played_songs: 0,
  unplayed_songs: 0,
  last_played_at: null,
  ...over,
});

const track = (over: Partial<SpotifyPlaylistTrack>): SpotifyPlaylistTrack => ({
  position: 0,
  spotify_id: 't',
  url: 'https://open.spotify.com/track/t',
  title: 'T',
  artists: ['A'],
  album: 'LP',
  duration_ms: 200_000,
  added_at: '2024-01-01T00:00:00Z',
  is_local: false,
  song_key: 't|a',
  plays: 0,
  first_played_at: null,
  last_played_at: null,
  album_ref: null,
  art_id: null,
  ...over,
});

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  resetSpotifyStatusCache();
  statusMock.mockResolvedValue(STATUS);
  window.history.replaceState(null, '', '/profile?tab=plugin:music&musicSection=playlists');
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('SpotifyButton', () => {
  it('opens the matched item in Spotify', async () => {
    linkMock.mockResolvedValue({ url: 'https://open.spotify.com/track/x', matched: true });
    inRouter(<SpotifyButton target={{ kind: 'song', songKey: 'k' }} />);
    const link = await screen.findByRole('link', { name: 'Open in Spotify' });
    expect(link.getAttribute('href')).toBe('https://open.spotify.com/track/x');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(linkMock).toHaveBeenCalledWith({ kind: 'song', songKey: 'k' });
  });

  it('searches Spotify when there is no exact match', async () => {
    linkMock.mockResolvedValue({ url: 'https://open.spotify.com/search/a%20b', matched: false });
    inRouter(<SpotifyButton target={{ kind: 'artist', name: 'A' }} />);
    expect((await screen.findByRole('link', { name: 'Search Spotify' })).getAttribute('href')).toBe('https://open.spotify.com/search/a%20b');
  });

  it('stays hidden until Spotify is set up', async () => {
    statusMock.mockResolvedValue({ ...STATUS, configured: false, connected: false });
    inRouter(<SpotifyButton target={{ kind: 'artist', name: 'A' }} />);
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(screen.queryByRole('link')).toBeNull();
    expect(linkMock).not.toHaveBeenCalled();
  });
});

describe('playlist helpers', () => {
  const rows = [
    playlist({ spotify_id: 'b', name: 'Beta', position: 1, last_modified_at: '2024-01-01T00:00:00Z', plays: 5 }),
    playlist({ spotify_id: 'a', name: 'Alpha', position: 2, last_modified_at: null, plays: 9, last_played_at: '2024-04-01T00:00:00Z' }),
    playlist({ spotify_id: 'c', name: 'Gamma', position: 0, last_modified_at: '2024-03-01T00:00:00Z', plays: 1, last_played_at: '2024-05-01T00:00:00Z' }),
  ];
  const ids = (r: SpotifyPlaylist[]) => r.map((p) => p.spotify_id);

  it('sorts in Spotify order, by last modified (unknown last), name, plays and last played', () => {
    expect(ids(sortPlaylists(rows, 'spotify'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortPlaylists(rows, 'modified'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortPlaylists(rows, 'name'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortPlaylists(rows, 'plays'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortPlaylists(rows, 'last_played'))).toEqual(['c', 'a', 'b']);
  });

  it('finds forgotten songs and top artists, each song once', () => {
    const tracks = [
      track({ position: 0, song_key: 'old', title: 'Old', plays: 10, last_played_at: '2023-01-01T00:00:00Z', artists: ['X'] }),
      track({ position: 1, song_key: 'old', title: 'Old', plays: 10, last_played_at: '2023-01-01T00:00:00Z', artists: ['X'] }),
      track({ position: 2, song_key: 'recent', title: 'Recent', plays: 3, last_played_at: '2024-04-30T00:00:00Z', artists: ['Y'] }),
      track({ position: 3, song_key: 'never', title: 'Never', plays: 0, artists: ['Y'] }),
    ];
    expect(forgottenTracks(tracks, 6, new Date('2024-05-01T00:00:00Z')).map((t) => t.title)).toEqual(['Old']);
    expect(topArtists(tracks)).toEqual([
      { name: 'X', plays: 10, songs: 1 },
      { name: 'Y', plays: 3, songs: 2 },
    ]);
  });
});

describe('MusicPlaylistsSection', () => {
  it('lists playlists with plays, remembers the sort, and opens one', async () => {
    const user = userEvent.setup();
    playlistsMock.mockResolvedValue([
      playlist({ spotify_id: 'mine', name: 'Trance', position: 0, plays: 12, unplayed_songs: 3, total_tracks: 20 }),
      playlist({ spotify_id: 'theirs', name: 'Editorial', position: 1, mine: false, owner_name: 'Spotify', tracks_available: false }),
    ]);
    playlistMock.mockResolvedValue({
      ...playlist({ spotify_id: 'mine', name: 'Trance' }),
      tracks: [
        track({ position: 0, title: 'Sun & Moon', song_key: 'sun', plays: 4, last_played_at: '2024-04-01T00:00:00Z' }),
        track({ position: 1, title: 'Never Played', song_key: 'never', plays: 0 }),
      ],
      daily: [{ date: '2024-04-01', plays: 4 }],
    });
    inRouter(<MusicPlaylistsSection />);

    const list = await screen.findByRole('list', { name: 'Playlists' });
    expect(within(list).getByText('12 plays')).toBeTruthy();
    expect(within(list).getByText('3 never played')).toBeTruthy();
    expect(within(list).getByText('Tracks not shared')).toBeTruthy();
    expect(within(list).getByText(/by Spotify/)).toBeTruthy();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort playlists' }), 'name');
    expect(within(list).getAllByRole('button').map((b) => b.textContent?.split(/\d/)[0])).toEqual([
      expect.stringContaining('Editorial'),
      expect.stringContaining('Trance'),
    ]);
    expect(window.localStorage.getItem('music.playlistSort')).toBe('name');

    await user.click(within(list).getByRole('button', { name: /Trance/ }));
    expect(await screen.findByRole('heading', { name: 'Trance' })).toBeTruthy();
    expect(playlistMock).toHaveBeenCalledWith('mine');
    expect(new URLSearchParams(window.location.search).get('musicPlaylist')).toBe('mine');
    const table = within(screen.getByRole('table', { name: 'Tracks' }));
    // A played song links to its page; one never played doesn't.
    expect(table.getByRole('link', { name: 'Sun & Moon' }).getAttribute('href')).toBe('/music/song?key=sun');
    expect(table.queryByRole('link', { name: 'Never Played' })).toBeNull();
    expect(table.getByText('Never')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Most played' })).getByText('4 plays')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'All playlists' }));
    expect(await screen.findByRole('list', { name: 'Playlists' })).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('musicPlaylist')).toBeNull();
  });

  it('points to Settings when Spotify is not connected', async () => {
    statusMock.mockResolvedValue({ ...STATUS, connected: false, configured: false, playlists: 0 });
    playlistsMock.mockResolvedValue([]);
    inRouter(<MusicPlaylistsSection />);
    expect((await screen.findByRole('link', { name: 'Settings → Music' })).getAttribute('href')).toBe('/settings?tab=plugin:music');
  });
});

describe('SpotifyExportButton', () => {
  it('exports a list, then offers to update it and lists what had no match', async () => {
    const user = userEvent.setup();
    getExportMock.mockResolvedValue(null);
    exportListMock.mockResolvedValue({
      list_id: 'l1',
      spotify_playlist_id: 'pl',
      url: 'https://open.spotify.com/playlist/pl',
      exported_at: '2024-05-01T12:00:00Z',
      track_count: 12,
      unmatched: [{ kind: 'song', title: 'Obscure', artists: ['A'] }],
      created: true,
    });
    inRouter(<SpotifyExportButton listId="l1" />);
    await user.click(await screen.findByRole('button', { name: 'Export to Spotify' }));
    expect(exportListMock).toHaveBeenCalledWith('l1');
    expect(await screen.findByText('Created with 12 tracks.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update on Spotify' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Spotify playlist' }).getAttribute('href')).toBe('https://open.spotify.com/playlist/pl');
    expect(screen.getByText('1 item not found on Spotify')).toBeTruthy();
    expect(screen.getByText('Obscure')).toBeTruthy();
  });

  it('is hidden while Spotify is not connected', async () => {
    statusMock.mockResolvedValue({ ...STATUS, connected: false });
    inRouter(<SpotifyExportButton listId="l1" />);
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
    expect(getExportMock).not.toHaveBeenCalled();
  });
});

describe('SpotifySettings', () => {
  it('shows the redirect URI to register and saves the app', async () => {
    const user = userEvent.setup();
    statusMock.mockResolvedValue({ ...STATUS, configured: false, connected: false, client_id: null });
    saveMock.mockResolvedValue({ ...STATUS, connected: false });
    inRouter(<SpotifySettings />);
    expect(await screen.findByText(`${window.location.origin}/api/v1/music/spotify/callback`)).toBeTruthy();
    await user.type(screen.getByLabelText('Client ID'), 'a'.repeat(32));
    await user.type(screen.getByLabelText('Client Secret'), 'b'.repeat(32));
    await user.click(screen.getByRole('button', { name: 'Save Spotify app' }));
    expect(saveMock).toHaveBeenCalledWith('a'.repeat(32), 'b'.repeat(32));
    expect(await screen.findByText('Spotify app saved. Now connect your account.')).toBeTruthy();
  });

  it('reports the outcome of the sign-in redirect and clears it from the URL', async () => {
    window.history.replaceState(null, '', '/settings?tab=plugin:music&spotify_error=Spotify%20access%20was%20not%20allowed.');
    statusMock.mockResolvedValue({ ...STATUS, connected: false });
    inRouter(<SpotifySettings />);
    expect(await screen.findByText('Spotify access was not allowed.')).toBeTruthy();
    expect([...new URLSearchParams(window.location.search)]).toEqual([['tab', 'plugin:music']]);
    expect(screen.getByRole('button', { name: /Connect Spotify/ })).toBeTruthy();
  });
});
