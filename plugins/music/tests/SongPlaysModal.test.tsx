import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SongPlaysModal, monthsBetween } from '../ui/SongPlaysModal';
import type { SongPlay } from '../ui/types';

const summaryMock = vi.fn();
const songPlaysMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: {
    songPlaysSummary: (...args: unknown[]) => summaryMock(...args),
    songPlays: (...args: unknown[]) => songPlaysMock(...args),
    lists: () => Promise.resolve([]),
  },
  albumArtUrl: (id: string) => `/art/${id}`,
}));

const play = (id: string, played_at: string, extra: Partial<SongPlay> = {}): SongPlay => ({
  id, played_at, timezone: 'America/Chicago', album: 'Discovery', album_ref: 'r', art_id: null,
  track_length: 201, listened_for: null, source: 'lastfm', session_id: null, session_date: null, ...extra,
});

function renderModal(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <SongPlaysModal songKey="k" onClose={onClose} />
    </MemoryRouter>,
  );
  return onClose;
}

describe('SongPlaysModal', () => {
  beforeEach(() => {
    summaryMock.mockResolvedValue({
      name: 'One More Time', artists: ['Daft Punk'], album_ref: 'r', art_id: null, plays: 3,
      first_played_at: '2024-01-05T12:00:00Z', last_played_at: '2024-03-02T12:00:00Z',
      monthly: [{ month: '2024-01', plays: 2 }, { month: '2024-03', plays: 1 }],
    });
    songPlaysMock.mockResolvedValue({
      rows: [
        // 03:30 UTC is still the evening before in Chicago.
        play('p1', '2024-03-02T03:30:00Z', { session_id: 's1', session_date: '2024-03-01' }),
        play('p2', '2024-01-05T12:00:00Z'),
      ],
      total: 3,
    });
  });
  afterEach(cleanup);

  it('shows the totals, a zero-filled monthly chart and each play in its own timezone', async () => {
    renderModal();
    expect(await screen.findByRole('heading', { name: 'One More Time' })).toBeTruthy();
    expect(screen.getByText(/3 plays/)).toBeTruthy();
    // Jan, Feb (empty) and Mar: two bars drawn, three slots.
    expect(screen.getByRole('img', { name: 'Plays per month from Jan 2024 to Mar 2024' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Mar 1, 2024')).toBeTruthy());
    const links = screen.getAllByRole('link');
    expect(links.some((a) => a.getAttribute('href') === '/music/plays/p1')).toBe(true);
    expect(screen.getByRole('link', { name: 'Show this listening session on Home' }).getAttribute('href')).toBe(
      '/?from=2024-03-01&to=2024-03-01',
    );
    expect(screen.getByText('Showing 2 of 3')).toBeTruthy();
  });

  it('loads the next page after the plays it has', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(songPlaysMock).toHaveBeenLastCalledWith('k', { limit: 100, offset: 2 }));
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = renderModal();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('lists every month between two', () => {
    expect(monthsBetween('2023-11', '2024-02')).toEqual(['2023-11', '2023-12', '2024-01', '2024-02']);
  });
});
