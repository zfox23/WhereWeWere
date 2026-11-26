import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
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
  it('puts every band and Other on one axis, from the first play of any to the last', () => {
    const { buckets, wave } = seriesWave(SERIES, 'month');
    expect(buckets.map((b) => b.start)).toEqual(['2024-01-01', '2024-02-01', '2024-03-01', '2024-04-01']);
    expect(wave.names).toEqual(['Song A', 'Song B']);
    expect(wave.buckets).toEqual([
      { counts: [3, 0], other: 1 },
      { counts: [0, 1], other: 0 },
      { counts: [2, 0], other: 0 },
      { counts: [0, 0], other: 1 },
    ]);
  });

  it('is empty without plays', () => {
    expect(seriesWave({ bands: [], other: { plays: 0, count: 0, daily: [] } }, 'year')).toEqual({ wave: { names: [], buckets: [] }, buckets: [] });
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
