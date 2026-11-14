import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListeningCalendar } from '../ui/insights/ListeningCalendar';
import { ListeningClock, hourLabel } from '../ui/insights/ListeningClock';
import { DiscoveryChart, bucketLabel } from '../ui/insights/DiscoveryChart';

const clockMock = vi.fn();
const discoveryMock = vi.fn();
const dailyMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: {
    listeningClock: (...args: unknown[]) => clockMock(...args),
    discovery: (...args: unknown[]) => discoveryMock(...args),
    dailyListening: (...args: unknown[]) => dailyMock(...args),
  },
}));

afterEach(cleanup);

describe('ListeningCalendar', () => {
  beforeEach(() => {
    dailyMock.mockReset().mockResolvedValue({
      days: [{ date: '2024-03-02', plays: 4, seconds: 800 }],
      listening_days: 1, longest_streak: 6, current_streak: 0,
    });
  });

  it('shows the year\'s days and streaks, and opens a day on Home', async () => {
    function HomeProbe() {
      return <p>home {useLocation().search}</p>;
    }
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<ListeningCalendar defaultYear={2024} />} />
          <Route path="/" element={<HomeProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('6 days')).toBeTruthy();
    expect(screen.getByText('0 days')).toBeTruthy();
    expect(dailyMock).toHaveBeenCalledWith(2024, expect.any(String));
    await user.click(screen.getByRole('button', { name: '2024-03-02: 4 plays' }));
    expect(await screen.findByText('home ?from=2024-03-02&to=2024-03-02')).toBeTruthy();
  });

  it('moves to another year', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ListeningCalendar defaultYear={2024} />
      </MemoryRouter>,
    );
    await screen.findByText('6 days');
    await user.click(screen.getByRole('button', { name: /2023/ }));
    await waitFor(() => expect(dailyMock).toHaveBeenLastCalledWith(2023, expect.any(String)));
  });
});

describe('ListeningClock', () => {
  beforeEach(() => {
    clockMock.mockReset().mockResolvedValue([
      { dow: 1, hour: 9, plays: 2, seconds: 100 },
      { dow: 5, hour: 22, plays: 1, seconds: 900 },
    ]);
  });

  it('names the busiest hour, and switches to listening time', async () => {
    const user = userEvent.setup();
    render(<ListeningClock from="2024-03-01" to="2024-03-31" />);
    expect(await screen.findByText('Busiest: Monday 9a–10a: 2 plays')).toBeTruthy();
    expect(clockMock).toHaveBeenCalledWith('2024-03-01', '2024-03-31');
    expect(screen.getByTestId('clock-1-9').getAttribute('style')).toContain('opacity: 1');
    expect(screen.getByTestId('clock-0-0').getAttribute('style')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Time' }));
    expect(screen.getByText('Busiest: Friday 10p–11p: 15m')).toBeTruthy();
  });

  it('says when nothing was played', async () => {
    clockMock.mockResolvedValue([]);
    render(<ListeningClock />);
    expect(await screen.findByText('Nothing played in this period.')).toBeTruthy();
  });

  it('labels hours', () => {
    expect([0, 1, 12, 13, 23].map(hourLabel)).toEqual(['12a', '1a', '12p', '1p', '11p']);
  });
});

describe('DiscoveryChart', () => {
  it('headlines the share of new plays and draws a bar per bucket', async () => {
    discoveryMock.mockResolvedValue({
      bucket: 'month',
      buckets: [
        { start: '2024-01-01', new_plays: 2, familiar_plays: 1, new_songs: 1, new_artists: 1 },
        { start: '2024-02-01', new_plays: 0, familiar_plays: 0, new_songs: 0, new_artists: 0 },
        { start: '2024-03-01', new_plays: 1, familiar_plays: 1, new_songs: 1, new_artists: 1 },
      ],
      totals: { plays: 5, new_plays: 3, new_songs: 2, new_artists: 2 },
    });
    render(<DiscoveryChart from="2024-01-01" to="2024-03-31" />);
    expect(await screen.findByText('60%')).toBeTruthy();
    expect(screen.getByText(/2 new songs · 2 new artists/)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'New and familiar plays per month' })).toBeTruthy();
    expect(screen.getByText('Jan 2024')).toBeTruthy();
    expect(screen.getByText('Mar 2024')).toBeTruthy();
  });

  it('labels buckets by size', () => {
    expect(bucketLabel('2024-03-04', 'week')).toBe('Week of Mar 4, 2024');
    expect(bucketLabel('2024-03-01', 'month')).toBe('Mar 2024');
    expect(bucketLabel('2024-01-01', 'year')).toBe('2024');
  });
});
