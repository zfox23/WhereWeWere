import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicCard } from '../ui/MusicCard';

const sessionTracksMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: { sessionTracks: (...args: unknown[]) => sessionTracksMock(...args), lists: () => Promise.resolve([]), deleteScrobble: (...args: unknown[]) => deleteMock(...args) },
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
    deleteMock.mockReset();
  });

  it('summarises the session', () => {
    renderCard();
    expect(screen.getByText(/Listening 12:00 PM – 1:15 PM UTC/)).toBeTruthy();
    expect(screen.getByText('1h 15m')).toBeTruthy();
    expect(screen.getByText('42 tracks · Khruangbin, Men I Trust, Boards of Canada, +1')).toBeTruthy();
    expect(sessionTracksMock).not.toHaveBeenCalled();
  });

  it('links each track\'s time to that play\'s own page', async () => {
    const user = userEvent.setup();
    sessionTracksMock.mockResolvedValue([
      { id: 'p1', played_at: '2024-05-01T12:00:00Z', title: 'Maria También', artists: ['Khruangbin'], album: null, track_length: null, listened_for: null, timezone: 'UTC' },
    ]);
    renderCard();
    await user.click(screen.getByRole('button'));
    const time = await screen.findByRole('link', { name: '12:00 PM UTC' });
    expect(time.getAttribute('href')).toBe('/music/plays/p1');
    // Following it doesn't fold the card up.
    expect(screen.getByRole('button', { name: /Listening/ }).getAttribute('aria-expanded')).toBe('true');
  });

  describe('songs written down by hand', () => {
    const tracks = () => [
      { id: 'm1', manual: true, played_at: '2024-05-01T12:30:00Z', title: 'Sun & Moon', artists: ['Above & Beyond'], album: null, track_length: null, listened_for: null, timezone: 'UTC',
        note: 'At the farmers market', companions: ['Sam', 'Riley'], latitude: 41.8781, longitude: -87.6298 },
      { id: 's1', manual: false, played_at: '2024-05-01T12:00:00Z', title: 'Scrobbled', artists: ['Someone'], album: null, track_length: null, listened_for: null, timezone: 'UTC', note: null, companions: [] },
    ];

    it('shows the note, companions and place, and only offers delete on hand-entered songs', async () => {
      const user = userEvent.setup();
      sessionTracksMock.mockResolvedValue(tracks());
      renderCard();
      await user.click(screen.getByRole('button'));
      await screen.findByText('At the farmers market');
      expect(screen.getByText(/with Sam, Riley/)).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Where I heard it' }).getAttribute('href')).toContain('mlat=41.8781&mlon=-87.6298');
      expect(screen.getByRole('button', { name: 'Delete Sun & Moon' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Delete Scrobbled' })).toBeNull();
    });

    it('deletes after confirmation and drops the row', async () => {
      const user = userEvent.setup();
      sessionTracksMock.mockResolvedValue(tracks());
      deleteMock.mockResolvedValue({ id: 'm1' });
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
      renderCard();
      await user.click(screen.getByRole('button'));
      await user.click(await screen.findByRole('button', { name: 'Delete Sun & Moon' }));
      expect(deleteMock).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Delete Sun & Moon' }));
      await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('m1'));
      await waitFor(() => expect(screen.queryByText('Sun & Moon')).toBeNull());
      expect(screen.getByText('Scrobbled')).toBeTruthy();
      confirm.mockRestore();
    });

    it('says so when deleting fails and keeps the row', async () => {
      const user = userEvent.setup();
      sessionTracksMock.mockResolvedValue(tracks());
      deleteMock.mockRejectedValue(new Error('boom'));
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      renderCard();
      await user.click(screen.getByRole('button'));
      await user.click(await screen.findByRole('button', { name: 'Delete Sun & Moon' }));
      expect(await screen.findByText("Couldn't delete that song.")).toBeTruthy();
      expect(screen.getByText('Sun & Moon')).toBeTruthy();
    });
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
    // Artist and title open the library in a new tab, without toggling the card.
    const artist = screen.getAllByRole('link', { name: 'Khruangbin' })[0];
    expect(artist.getAttribute('href')).toContain('musicView=artists&q=Khruangbin');
    expect(artist.getAttribute('target')).toBe('_blank');
    expect(screen.getByRole('link', { name: 'Evidence' }).getAttribute('href')).toContain('q=Evidence');
    // Each track's clock time is in the zone it was played in.
    expect(screen.getByText('12:00 PM UTC')).toBeTruthy();
    expect(screen.getByText(/^12:30 AM (GMT\+12|NZST)$/)).toBeTruthy();
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
