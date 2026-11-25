import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicSettings } from '../ui/MusicSettings';

const settingsMock = vi.fn();
const updateMock = vi.fn();
const regenerateMock = vi.fn();
const importMock = vi.fn();
const lastfmMock = vi.fn();
const albumStatusMock = vi.fn();
const albumStartMock = vi.fn();
const refreshMock = vi.fn();
const genreStatusMock = vi.fn();
const genreStartMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: {
    settings: () => settingsMock(),
    updateSettings: (...args: unknown[]) => updateMock(...args),
    regenerateKey: () => regenerateMock(),
    importScrobbles: (...args: unknown[]) => importMock(...args),
    importLastfm: (...args: unknown[]) => lastfmMock(...args),
    albumStatus: () => albumStatusMock(),
    startAlbumBackfill: (...args: unknown[]) => albumStartMock(...args),
    cancelAlbumBackfill: vi.fn(),
    refreshTimezones: () => refreshMock(),
    duplicates: vi.fn(),
    removeDuplicates: vi.fn(),
    genreStatus: () => genreStatusMock(),
    startGenreBackfill: (...args: unknown[]) => genreStartMock(...args),
    cancelGenreBackfill: vi.fn(),
  },
}));

const SETTINGS = {
  scrobbler_key: 'abc123key',
  session_gap_minutes: 30,
  min_session_tracks: 3,
  timezone: 'UTC',
  scrobbles: 1234,
  last_scrobbled_at: '2024-05-01T12:00:00Z',
};

describe('MusicSettings', () => {
  beforeEach(() => {
    settingsMock.mockResolvedValue(SETTINGS);
    albumStatusMock.mockResolvedValue({
      enabled: true,
      albums: { total: 10, matched: 6, not_found: 1, pending: 3 },
      job: { state: 'idle', processed: 0, total: 0, matched: 0, not_found: 0, skipped: 0, durations_filled: 0, thumbnails_restored: 0, error: null },
    });
    genreStatusMock.mockResolvedValue({
      enabled: true,
      counts: { artists: { found: 3, not_found: 1 }, albums: { found: 5, not_found: 2 }, pending: 4, plays: 200, plays_with_genres: 150 },
      job: { state: 'idle', phase: null, processed: 0, total: 0, found: 0, not_found: 0, skipped: 0, error: null },
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    settingsMock.mockReset();
    updateMock.mockReset();
    regenerateMock.mockReset();
    importMock.mockReset();
    lastfmMock.mockReset();
    albumStatusMock.mockReset();
    albumStartMock.mockReset();
    genreStatusMock.mockReset();
    genreStartMock.mockReset();
    refreshMock.mockReset();
  });

  it('shows what to give multi-scrobbler, and the stored count', async () => {
    render(<MusicSettings />);
    await waitFor(() => expect(screen.getByText('abc123key')).toBeTruthy());
    expect(screen.getByText(window.location.origin)).toBeTruthy();
    expect(screen.getByText('MALOJA_API_KEY')).toBeTruthy();
    expect(screen.getByText(/1,234 scrobbles stored/)).toBeTruthy();
  });

  it('rotates the key only after confirmation', async () => {
    const user = userEvent.setup();
    regenerateMock.mockResolvedValue({ scrobbler_key: 'newkey' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<MusicSettings />);
    await waitFor(() => screen.getByText('abc123key'));
    await user.click(screen.getByRole('button', { name: /Regenerate key/ }));
    expect(regenerateMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Regenerate key/ }));
    await waitFor(() => expect(screen.getByText('newkey')).toBeTruthy());
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('saves session preferences as numbers', async () => {
    const user = userEvent.setup();
    updateMock.mockResolvedValue({ ...SETTINGS, session_gap_minutes: 45, min_session_tracks: 5, timezone: 'America/Chicago' });
    render(<MusicSettings />);
    await waitFor(() => screen.getByText('abc123key'));
    await user.clear(screen.getByLabelText('Session gap (minutes)'));
    await user.type(screen.getByLabelText('Session gap (minutes)'), '45');
    await user.clear(screen.getByLabelText('Minimum tracks on timeline'));
    await user.type(screen.getByLabelText('Minimum tracks on timeline'), '5');
    await user.clear(screen.getByLabelText('Fallback timezone'));
    await user.type(screen.getByLabelText('Fallback timezone'), 'America/Chicago');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
    expect(updateMock).toHaveBeenCalledWith({ session_gap_minutes: 45, min_session_tracks: 5, timezone: 'America/Chicago' });
  });

  it('surfaces a save error', async () => {
    const user = userEvent.setup();
    updateMock.mockRejectedValue(new Error('Invalid timezone'));
    render(<MusicSettings />);
    await waitFor(() => screen.getByText('abc123key'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Invalid timezone')).toBeTruthy());
  });

  it('imports a history file and reports the outcome', async () => {
    const user = userEvent.setup();
    importMock.mockResolvedValue({ parsed: 10, inserted: 7, duplicates: 3, skipped: 1 });
    render(<MusicSettings />);
    await waitFor(() => screen.getByText('abc123key'));
    expect(screen.queryByRole('button', { name: /^Import$/ })).toBeNull();
    const file = new File(['{"scrobbles":[]}'], 'maloja_export.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Scrobble export (.json)'), file);
    await user.click(screen.getByRole('button', { name: /^Import$/ }));
    await waitFor(() => expect(screen.getByText(/Imported 7 new scrobbles, 3 already present, 1 unreadable\./)).toBeTruthy());
    expect(importMock).toHaveBeenCalledWith(file);
    // The count is refreshed after an import.
    expect(settingsMock).toHaveBeenCalledTimes(2);
  });

  it('warns that Maloja imports split artist credits', async () => {
    render(<MusicSettings />);
    await waitFor(() => screen.getByText('abc123key'));
    expect(screen.getByText(/Maloja splits artist credits/)).toBeTruthy();
  });

  it('imports a Last.fm CSV and reports the outcome', async () => {
    const user = userEvent.setup();
    lastfmMock.mockResolvedValue({ parsed: 8, inserted: 8, duplicates: 0, skipped: 0 });
    render(<MusicSettings />);
    await waitFor(() => screen.getByText('abc123key'));
    const file = new File(['uts,artist,track\n'], 'lastfm.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText('Last.fm export (.csv)'), file);
    await user.click(screen.getByRole('button', { name: /^Import$/ }));
    await waitFor(() => expect(screen.getByText(/Imported 8 new scrobbles\./)).toBeTruthy());
    expect(lastfmMock).toHaveBeenCalledWith(file);
    expect(importMock).not.toHaveBeenCalled();
  });

  it('shows metadata lookup progress and starts a lookup, optionally retrying misses', async () => {
    const user = userEvent.setup();
    albumStartMock.mockResolvedValue({});
    render(<MusicSettings />);
    await waitFor(() => screen.getByText(/6 matched, 1 not found, 3 waiting, of 10 albums/));
    await user.click(screen.getByLabelText(/retry albums that weren't found/));
    await user.click(screen.getByRole('button', { name: 'Update music metadata' }));
    expect(albumStartMock).toHaveBeenCalledWith(true);
  });

  it('re-assigns play timezones on request and reports how many changed', async () => {
    const user = userEvent.setup();
    refreshMock.mockResolvedValueOnce({ updated: 1200 }).mockRejectedValueOnce(new Error('boom'));
    render(<MusicSettings />);
    await waitFor(() => screen.getByText('abc123key'));
    await user.click(screen.getByRole('button', { name: /Re-assign timezones/ }));
    await waitFor(() => expect(screen.getByText('Updated 1,200 plays.')).toBeTruthy());
    // The stored count is reloaded afterwards.
    expect(settingsMock).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: /Re-assign timezones/ }));
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });

  it('shows an import error', async () => {
    const user = userEvent.setup();
    importMock.mockRejectedValue(new Error('File is not valid JSON'));
    render(<MusicSettings />);
    await waitFor(() => screen.getByText('abc123key'));
    await user.upload(screen.getByLabelText('Scrobble export (.json)'), new File(['x'], 'x.json', { type: 'application/json' }));
    await user.click(screen.getByRole('button', { name: /^Import$/ }));
    await waitFor(() => expect(screen.getByText('File is not valid JSON')).toBeTruthy());
  });
  it('shows genre coverage and starts a genre lookup, optionally retrying misses', async () => {
    const user = userEvent.setup();
    genreStartMock.mockResolvedValue({});
    render(<MusicSettings />);
    await waitFor(() => screen.getByText(/150 of 200 plays \(75%\) have genres/));
    expect(document.body.textContent).toContain('Artists: 3 with genres, 1 without. Albums: 5 with genres, 2 without. 4 waiting.');
    await user.click(screen.getByLabelText(/retry albums and artists that had no genres/));
    await user.click(screen.getByRole('button', { name: 'Update genres' }));
    expect(genreStartMock).toHaveBeenCalledWith(true);
  });

  it('shows a running genre lookup\'s phase and progress', async () => {
    genreStatusMock.mockResolvedValue({
      enabled: true,
      counts: { artists: { found: 3, not_found: 1 }, albums: { found: 0, not_found: 0 }, pending: 9, plays: 200, plays_with_genres: 90 },
      job: { state: 'running', phase: 'album', processed: 4, total: 13, found: 3, not_found: 1, skipped: 0, error: null },
    });
    render(<MusicSettings />);
    expect(await screen.findByText('Albums: 4 of 13 looked up, 3 with genres')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update genres' })).toHaveProperty('disabled', true);
  });

});
