import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaysWave, seriesWave } from '../ui/insights/PlaysWave';
import type { PlaySeries } from '../ui/types';

const SERIES: PlaySeries = {
  bands: [
    { key: 'a|x', name: 'Song A', artists: ['X'], plays: 5, daily: [{ date: '2024-01-10', plays: 3 }, { date: '2024-03-02', plays: 2 }] },
    { key: 'b|x', name: 'Song B', artists: ['X'], plays: 1, daily: [{ date: '2024-02-14', plays: 1 }] },
  ],
  other: { plays: 2, count: 4, daily: [{ date: '2024-01-20', plays: 1 }, { date: '2024-04-01', plays: 1 }] },
};

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

afterEach(cleanup);

describe('seriesWave', () => {
  it('lays every band and Other on one axis of days, from the first play of any to the last', () => {
    const wave = seriesWave(SERIES)!;
    expect(wave.first).toBe('2024-01-10');
    expect(wave.names).toEqual(['Song A', 'Song B']);
    // Jan 10 to Apr 1: 22 + 29 + 31 + 1 days.
    expect(wave.other).toHaveLength(83);
    expect(wave.bands.every((b) => b.length === 83)).toBe(true);
    expect(wave.bands[0][0]).toBe(3);
    expect(wave.bands[0].reduce((n, v) => n + v, 0)).toBe(5);
    expect(wave.bands[1][35]).toBe(1); // Feb 14
    expect(wave.other[82]).toBe(1); // Apr 1
  });

  it('is nothing without plays', () => {
    expect(seriesWave({ bands: [], other: { plays: 0, count: 0, daily: [] } })).toBeNull();
  });
});

describe('PlaysWave', () => {
  const renderWave = () =>
    render(
      <MemoryRouter>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <PlaysWave series={SERIES} bucket="month" onBucketChange={() => {}} bandHref={(k) => `/music/song?key=${k}`} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

  it('says how much the bands cover, sums the rest, and opens a song from its band', () => {
    renderWave();
    expect(screen.getByText('Plays per month of the 2 most played songs, 75% of all plays.')).toBeTruthy();
    expect(screen.getByText('Other songs, not drawn: 2 plays of 4 more songs.')).toBeTruthy();
    const wave = screen.getByRole('img', { name: 'Plays per month by song' });
    fireEvent.click(wave.querySelectorAll('path')[1]);
    expect(screen.getByTestId('where').textContent).toBe('/music/song?key=b|x');
  });

  it('pops up a moment\'s total, its songs and the rest', () => {
    renderWave();
    const svg = screen.getByRole('img', { name: 'Plays per month by song' });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 200, right: 600, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(svg, { clientX: 0, clientY: 100, pointerType: 'mouse' });
    const popup = screen.getByRole('status');
    expect(popup.textContent).toContain('Jan 2024');
    expect(popup.textContent).toContain('4 plays');
    expect(within(popup).getAllByRole('listitem').map((r) => r.textContent)).toEqual(['Song A3 · 75%', 'Other songs1 · 25%']);
  });
});

describe('PlaysWave top 8 for the stretch in view', () => {
  const RANKED: PlaySeries = { ...SERIES, bands: [SERIES.bands[1], SERIES.bands[0]] };
  const wave = (rerank: (r: { from: string; to: string }) => Promise<PlaySeries>, bucket: 'month' | 'week' = 'month') => (
    <MemoryRouter>
      <PlaysWave series={SERIES} bucket={bucket} onBucketChange={() => {}} rerank={rerank} />
    </MemoryRouter>
  );
  const renderRanked = (rerank: (r: { from: string; to: string }) => Promise<PlaySeries>) => render(wave(rerank));
  const bandNames = () => [...screen.getByRole('img', { name: /^Plays per \w+ by song$/ }).querySelectorAll('path title')].map((t) => t.textContent);

  it('re-picks the bands for the stretch in view, and keeps them until pressed again', async () => {
    const rerank = vi.fn().mockResolvedValue(RANKED);
    const { rerender } = renderRanked(rerank);
    expect(bandNames()).toEqual(['Song A', 'Song B']);
    // The full view: January to April, as whole months.
    const button = screen.getByRole('button', { name: 'Show the top 8 for Jan 1, 2024 – Apr 30, 2024' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(rerank).toHaveBeenCalledWith({ from: '2024-01-01', to: '2024-04-30' });
    expect(bandNames()).toEqual(['Song B', 'Song A']);
    expect(screen.getByText(/most played songs for Jan 1, 2024 – Apr 30, 2024, 75% of all plays/)).toBeTruthy();
    // Changing the grouping keeps them.
    rerender(wave(rerank, 'week'));
    expect(screen.getByRole('img', { name: 'Plays per week by song' })).toBeTruthy();
    expect(bandNames()).toEqual(['Song B', 'Song A']);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Show the top 8/ }));
    });
    expect(rerank).toHaveBeenCalledTimes(2);
  });

  it('keeps the bands and says so when re-picking fails', async () => {
    renderRanked(vi.fn().mockRejectedValue(new Error('down')));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Show the top 8/ }));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /the last try failed/ })).toBeTruthy());
    expect(bandNames()).toEqual(['Song A', 'Song B']);
  });

  it('has no button without a way to re-pick', () => {
    render(
      <MemoryRouter>
        <PlaysWave series={SERIES} bucket="month" onBucketChange={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /Show the top 8/ })).toBeNull();
  });
});
