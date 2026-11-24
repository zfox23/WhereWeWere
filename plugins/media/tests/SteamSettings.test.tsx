import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SteamSettings } from '../ui/SteamSettings';

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  verify: vi.fn(),
  status: vi.fn(),
  jobStart: vi.fn(),
}));

vi.mock('../ui/api', () => ({
  steam: { verify: mocks.verify, status: mocks.status, games: vi.fn().mockResolvedValue([]) },
  media: { library: vi.fn() },
}));

vi.mock('../../../client/src/plugins/api', () => ({
  plugins: { settings: { get: mocks.settingsGet, set: mocks.settingsSet } },
}));

vi.mock('../../../client/src/api/client', () => ({
  jobs: { start: mocks.jobStart, get: vi.fn() },
}));

const STEAM_ID = '76561197960287930';

describe('SteamSettings', () => {
  beforeEach(() => {
    mocks.settingsGet.mockResolvedValue({});
    mocks.settingsSet.mockResolvedValue({});
    mocks.status.mockResolvedValue({
      configured: false, last_synced_at: null, last_attempt_at: null, last_error: null,
      last_summary: null, unmatched: 0, unmatched_all: 0, ignored: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('verifies a custom URL name, then saves the resolved SteamID64', async () => {
    mocks.verify.mockResolvedValue({ steamid64: STEAM_ID, persona_name: 'Gabe', game_count: 12 });
    render(<SteamSettings />);
    // Typing before the stored settings load would be overwritten by them.
    const save = screen.getByRole('button', { name: /save & verify/i }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Steam Web API key'), { target: { value: 'key-1' } });
    fireEvent.change(screen.getByLabelText('Steam ID'), { target: { value: 'gabe' } });
    fireEvent.click(save);

    expect(await screen.findByText('Connected as Gabe · 12 games.')).toBeTruthy();
    expect(mocks.verify).toHaveBeenCalledWith('key-1', 'gabe');
    expect(mocks.settingsSet).toHaveBeenCalledWith('media', {
      steam_api_key: 'key-1', steam_id: STEAM_ID, steam_auto_sync: true,
    });
    expect((screen.getByLabelText('Steam ID') as HTMLInputElement).value).toBe(STEAM_ID);
  });

  it('does not save when Steam rejects the details', async () => {
    mocks.verify.mockRejectedValue(new Error('Steam rejected the API key.'));
    render(<SteamSettings />);
    const save = screen.getByRole('button', { name: /save & verify/i }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Steam Web API key'), { target: { value: 'bad' } });
    fireEvent.change(screen.getByLabelText('Steam ID'), { target: { value: STEAM_ID } });
    fireEvent.click(save);

    expect(await screen.findByText('Steam rejected the API key.')).toBeTruthy();
    expect(mocks.settingsSet).not.toHaveBeenCalled();
  });

  it('enables Sync Now once Steam is set up and starts the sync job', async () => {
    mocks.settingsGet.mockResolvedValue({ steam_api_key: 'k', steam_id: STEAM_ID });
    mocks.status.mockResolvedValue({
      configured: true, last_synced_at: '2026-11-24T10:00:00Z', last_attempt_at: '2026-11-24T10:00:00Z',
      last_error: null,
      last_summary: { games: 10, matched: 8, newly_matched: 1, time_updated: 3, checkins_created: 2, unmatched: 2, ignored: 0 },
      unmatched: 2, unmatched_all: 2, ignored: 0,
    });
    mocks.jobStart.mockResolvedValue({ id: 'job-1', status: 'pending' });
    render(<SteamSettings />);
    const sync = await screen.findByRole('button', { name: /sync steam now/i }) as HTMLButtonElement;
    await waitFor(() => expect(sync.disabled).toBe(false));
    expect(screen.getByText(/3 time played updated · 2 check-ins added/)).toBeTruthy();
    expect(screen.getByText('2 Steam games need review')).toBeTruthy();
    fireEvent.click(sync);
    await waitFor(() => expect(mocks.jobStart).toHaveBeenCalledWith('steam-sync'));
  });
});
