import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicCard } from '../ui/MusicCard';

const sessionTracksMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: { sessionTracks: (...args: unknown[]) => sessionTracksMock(...args) },
}));

const item = {
  type: 'music',
  id: 'session-1',
  checked_in_at: '2024-05-01T13:15:00Z',
  timezone: 'UTC',
  data: {
    started_at: '2024-05-01T12:00:00Z',
    ended_at: '2024-05-01T13:15:00Z',
    track_count: 42,
    listened_seconds: 4500,
    top_artists: ['Khruangbin', 'Men I Trust', 'Boards of Canada', 'Tycho'],
  },
} as any;

function renderCard(state: unknown = null) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
      <MusicCard item={item} integrations={{}} />
    </MemoryRouter>,
  );
}

describe('MusicCard', () => {
  afterEach(() => {
    cleanup();
    sessionTracksMock.mockReset();
  });

  it('summarises the session', () => {
    renderCard();
    expect(screen.getByText(/Listening 12:00 PM – 1:15 PM/)).toBeTruthy();
    expect(screen.getByText('1h 15m')).toBeTruthy();
    expect(screen.getByText('42 tracks · Khruangbin, Men I Trust, Boards of Canada, +1')).toBeTruthy();
    expect(sessionTracksMock).not.toHaveBeenCalled();
  });

  it('loads the tracks once, on first expand', async () => {
    const user = userEvent.setup();
    sessionTracksMock.mockResolvedValue([
      { played_at: '2024-05-01T12:00:00Z', title: 'Maria También', artists: ['Khruangbin'], album: null, track_length: null, listened_for: null, timezone: 'UTC' },
      { played_at: '2024-05-01T12:30:00Z', title: 'Evidence', artists: ['Khruangbin'], album: null, track_length: null, listened_for: null, timezone: 'Pacific/Auckland' },
    ]);
    renderCard();
    const toggle = screen.getByRole('button');
    await user.click(toggle);
    await waitFor(() => expect(screen.getByText(/Maria También/)).toBeTruthy());
    expect(sessionTracksMock).toHaveBeenCalledWith('session-1');
    // Each track's clock time is in the zone it was played in.
    expect(screen.getByText('12:00 PM')).toBeTruthy();
    expect(screen.getByText('12:30 AM')).toBeTruthy();
    await user.click(toggle);
    await user.click(toggle);
    expect(sessionTracksMock).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows an error when the tracks fail to load', async () => {
    const user = userEvent.setup();
    sessionTracksMock.mockRejectedValue(new Error('nope'));
    renderCard();
    await user.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByText("Couldn't load tracks.")).toBeTruthy());
  });

  describe('when another card links to this session', () => {
    const wrapper = () => document.querySelector('[data-highlighted]');

    afterEach(() => {
      vi.useRealTimers();
    });

    it('opens itself, loads its tracks and highlights briefly', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      sessionTracksMock.mockResolvedValue([
        { played_at: '2024-05-01T12:00:00Z', title: 'Maria También', artists: ['Khruangbin'], album: null, track_length: null, listened_for: null, timezone: 'UTC' },
      ]);
      renderCard({ focusSession: 'session-1' });
      await waitFor(() => expect(screen.getByText(/Maria También/)).toBeTruthy());
      expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
      expect(sessionTracksMock).toHaveBeenCalledWith('session-1');
      expect(wrapper()).not.toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600);
      });
      expect(wrapper()).toBeNull();
      // Still open once the highlight is gone.
      expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    });

    it('ignores a link to a different session, and stays collapsed without one', () => {
      renderCard({ focusSession: 'some-other-session' });
      expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
      expect(wrapper()).toBeNull();
      expect(sessionTracksMock).not.toHaveBeenCalled();
    });
  });
});
