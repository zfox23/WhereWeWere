import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaSettings } from '../ui/MediaSettings';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  stats: vi.fn(),
  settingsGet: vi.fn(),
}));

vi.mock('../ui/api', () => ({
  plexWebhook: { token: mocks.token, stats: mocks.stats },
}));

vi.mock('../../../client/src/plugins/api', () => ({
  plugins: { settings: { get: mocks.settingsGet, set: vi.fn() } },
}));

vi.mock('../ui/YamtrackImportSection', () => ({ YamtrackImportSection: () => null }));

describe('MediaSettings Plex webhook URL', () => {
  beforeEach(() => {
    mocks.stats.mockResolvedValue({ count: 3 });
    mocks.settingsGet.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the per-user URL ending in the webhook token', async () => {
    mocks.token.mockResolvedValue({ token: 'abc123' });
    render(<MediaSettings />);
    expect(await screen.findByText(`${window.location.origin}/api/v1/webhook/plex/abc123`)).toBeTruthy();
    expect(screen.getByText(/Regenerating your webhook token in Account settings changes it/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /copy/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('never shows a tokenless URL while the token is missing', async () => {
    mocks.token.mockRejectedValue(new Error('nope'));
    render(<MediaSettings />);
    expect(await screen.findByText('Could not load your webhook URL')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/\/api\/v1\/webhook\/plex/)).toBeNull());
    expect((screen.getByRole('button', { name: /copy/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
