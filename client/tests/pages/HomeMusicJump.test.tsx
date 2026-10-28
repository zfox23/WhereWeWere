import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home from '../../src/pages/Home';

const timelineListMock = vi.fn();
const aroundMock = vi.fn();
const sessionTracksMock = vi.fn();

vi.mock('../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client')>();
  return {
    ...actual,
    timeline: { ...actual.timeline, list: (...args: unknown[]) => timelineListMock(...args) },
    settings: { ...actual.settings, get: () => Promise.resolve({}), update: () => Promise.resolve({}) },
    musicListening: { around: (...args: unknown[]) => aroundMock(...args) },
  };
});
vi.mock('../../src/plugins/api', () => ({
  plugins: { settings: { get: () => Promise.resolve({}) } },
}));
vi.mock('../../../plugins/music/ui/api', () => ({
  music: { sessionTracks: (...args: unknown[]) => sessionTracksMock(...args), lists: () => Promise.resolve([]) },
}));

const SLEEP_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

const sleepItem = {
  type: 'sleep',
  id: SLEEP_ID,
  user_id: 'u',
  checked_in_at: '2024-05-01T12:15:00Z',
  created_at: '2024-05-01T12:15:00Z',
  timezone: 'UTC',
  data: { started_at: '2024-05-01T04:00:00Z', ended_at: '2024-05-01T12:15:00Z', sleep_timezone: 'UTC', rating: 4 },
};
const sessionItem = {
  type: 'music',
  id: SESSION_ID,
  user_id: 'u',
  checked_in_at: '2024-05-01T12:30:00Z',
  created_at: '2024-05-01T12:30:00Z',
  timezone: 'UTC',
  data: {
    started_at: '2024-05-01T12:00:00Z',
    ended_at: '2024-05-01T12:30:00Z',
    track_count: 12,
    listened_seconds: 1800,
    top_artists: ['Khruangbin'],
  },
};

const LISTENING = {
  session_id: SESSION_ID,
  session_date: '2024-05-01',
  anchor_time: 360,
  tracks: [
    { artists: ['Khruangbin'], title: 'Newest Song', time: 300 },
    { artists: ['Tycho'], title: 'Middle Song', time: 200 },
    { artists: ['Boards of Canada'], title: 'Oldest Song', time: 100 },
  ],
  has_more: true,
};

function Probe() {
  const loc = useLocation();
  return <div data-testid="probe">{loc.search}|{JSON.stringify(loc.state)}</div>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Probe />
      <Routes>
        <Route path="*" element={<Home />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Home: jumping from a check-in to its listening session', () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }));
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    // Unfiltered feed shows the check-in; the day filter adds the session card.
    timelineListMock.mockImplementation((params: Record<string, string>) =>
      Promise.resolve(params.from ? [sessionItem, sleepItem] : [sleepItem]),
    );
    aroundMock.mockImplementation((ids: string[]) =>
      Promise.resolve(ids.includes(SLEEP_ID) ? { [SLEEP_ID]: LISTENING } : {}),
    );
    sessionTracksMock.mockResolvedValue([
      { played_at: '2024-05-01T12:00:00Z', title: 'Track Inside Session', artists: ['Khruangbin'], album: null, track_length: null, listened_for: null, timezone: 'UTC' },
    ]);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    timelineListMock.mockReset();
    aroundMock.mockReset();
    sessionTracksMock.mockReset();
    scrollIntoView.mockReset();
  });

  it('shows the last song on a check-in card, with a count of the earlier ones', async () => {
    renderHome();
    await waitFor(() => expect(screen.getByText('Newest Song', { exact: false })).toBeTruthy());
    expect(aroundMock).toHaveBeenCalledWith([SLEEP_ID]);
    const lines = screen.getAllByRole('listitem').filter((li) => /Song/.test(li.textContent ?? ''));
    expect(lines.map((li) => li.textContent)).toEqual(['Khruangbin — Newest Song']);
    expect(screen.getByRole('button', { name: 'Show 2 earlier songs' }).textContent).toBe('+2');
  });

  it('jumps to the session card, expanded and highlighted, then clears the link state', async () => {
    const user = userEvent.setup();
    renderHome();
    await waitFor(() => screen.getByText('Newest Song', { exact: false }));
    expect(screen.queryByText(/Listening/)).toBeNull();

    // Any part of a line that isn't an artist/title link works.
    await user.click(screen.getByText('Newest Song', { exact: false }).closest('li')!);

    // The day is filtered to the session's date...
    await waitFor(() => expect(timelineListMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: '2024-05-01', to: '2024-05-01' }),
    ));
    // ...and the session card is there, open and highlighted.
    await waitFor(() => expect(screen.getByText('Track Inside Session', { exact: false })).toBeTruthy());
    expect(sessionTracksMock).toHaveBeenCalledWith(SESSION_ID);
    const wrapper = document.querySelector('[data-timeline-id="' + SESSION_ID + '"]') as HTMLElement;
    expect(wrapper.querySelector('[data-highlighted="true"]')).not.toBeNull();
    // Scrolled to that card.
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts.some((el) => el === wrapper)).toBe(true);
    // The check-in's own preview doesn't appear on the session card.
    expect(wrapper.querySelector('[aria-label="Show this listening session on the timeline"]')).toBeNull();
  });

  it('forgets the link after a moment so a reload does not repeat the jump', async () => {
    const user = userEvent.setup();
    renderHome();
    await waitFor(() => screen.getByText('Newest Song', { exact: false }));
    await user.click(screen.getByText('Newest Song', { exact: false }).closest('li')!);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain(SESSION_ID));
    // Real timers: the clear delay is a few seconds.
    await waitFor(
      () => expect(screen.getByTestId('probe').textContent).toBe('?from=2024-05-01&to=2024-05-01|null'),
      { timeout: 7000 },
    );
    // The card stays open after the state is gone.
    expect(screen.getByText('Track Inside Session', { exact: false })).toBeTruthy();
  }, 15000);
});
