import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenreWaveChart, basisPath, layoutWave } from '../ui/insights/GenreWaveChart';
import type { GenreStream } from '../ui/types';

const streamMock = vi.fn();
vi.mock('../ui/api', () => ({
  music: { genreStream: (...args: unknown[]) => streamMock(...args) },
}));

const STREAM: GenreStream = {
  bucket: 'month',
  genres: ['trance', 'house'],
  buckets: [
    { start: '2024-01-01', counts: [6, 2], other: 2, other_top: [{ name: 'ambient', plays: 2 }] },
    { start: '2024-02-01', counts: [0, 4], other: 0, other_top: [] },
    { start: '2024-03-01', counts: [3, 3], other: 1, other_top: [{ name: 'techno', plays: 1 }] },
  ],
  plays: 20,
  plays_with_genres: 15,
};

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

const renderChart = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<><GenreWaveChart from="2024-01-01" to="2024-03-31" /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );

/** Give the chart a size, and hover it at a fraction across and down. */
function hover(svg: Element, fx: number, fy: number) {
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 200, right: 600, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.pointerMove(svg, { clientX: fx * 600, clientY: fy * 200, pointerType: 'mouse' });
}

afterEach(cleanup);

describe('layoutWave', () => {
  it('stacks the bands, then Other, around a centre line', () => {
    const { bands, xs, y } = layoutWave(STREAM, 600, 200);
    expect(xs).toEqual([0, 300, 600]);
    // Ten plays in January: from -5 to +5, trance at the bottom, Other on top.
    expect(bands[0]).toEqual({ lo: [-5, -2, -3.5], hi: [1, -2, -0.5] });
    expect(bands[1]).toEqual({ lo: [1, -2, -0.5], hi: [3, 2, 2.5] });
    expect(bands[2]).toEqual({ lo: [3, 2, 2.5], hi: [5, 2, 3.5] });
    // The thickest bucket spans the height, less a small margin; 0 is the middle.
    expect(y(0)).toBe(100);
    expect(y(5) - y(-5)).toBeCloseTo(-192);
  });
});

describe('basisPath', () => {
  it('starts and ends on the end points', () => {
    const d = basisPath([[0, 10], [50, 0], [100, 10]]);
    expect(d.startsWith('M0,10')).toBe(true);
    expect(d.endsWith('L100,10')).toBe(true);
    expect(basisPath([[0, 1], [10, 2]], 'L')).toBe('L0,1L10,2');
  });
});

describe('GenreWaveChart', () => {
  beforeEach(() => {
    streamMock.mockReset().mockResolvedValue(STREAM);
  });

  it('draws a band per top genre and Other, with no legend or table', async () => {
    renderChart();
    const chart = await screen.findByRole('img', { name: 'Plays per month of the top genres' });
    expect(streamMock).toHaveBeenCalledWith('2024-01-01', '2024-03-31');
    expect(chart.querySelectorAll('path')).toHaveLength(3);
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Show genres as' })).toBeNull();
    expect(screen.getByText(/75% of plays have genres/)).toBeTruthy();
    expect(screen.getByText('Jan 2024')).toBeTruthy();
    expect(screen.getByText('Mar 2024')).toBeTruthy();
  });

  it('names the band under the pointer, and what Other holds', async () => {
    renderChart();
    const svg = await screen.findByRole('img', { name: 'Plays per month of the top genres' });
    // January, near the bottom: trance (6 of 10 plays).
    hover(svg, 0, 0.9);
    expect(screen.getByText('Jan 2024 · trance: 6 plays (60%)')).toBeTruthy();
    // January, near the top: Other.
    hover(svg, 0, 0.06);
    expect(screen.getByText('Jan 2024 · Other: 2 plays (most: ambient 2)')).toBeTruthy();
    // Outside every band: the month's biggest genres.
    hover(svg, 0.5, 0.02);
    expect(screen.getByText('Feb 2024 · house 4')).toBeTruthy();
    fireEvent.pointerLeave(svg, { pointerType: 'mouse' });
    expect(screen.queryByText(/Feb 2024 ·/)).toBeNull();
  });

  it('opens a genre when its band is clicked', async () => {
    renderChart();
    const chart = await screen.findByRole('img', { name: 'Plays per month of the top genres' });
    fireEvent.click(chart.querySelectorAll('path')[1]);
    expect(screen.getByTestId('where').textContent).toBe('/music/genre?name=house');
  });

  it('points to Settings when nothing in the period has genres yet', async () => {
    streamMock.mockResolvedValue({ ...STREAM, genres: [], buckets: [], plays: 20, plays_with_genres: 0 });
    renderChart();
    expect(await screen.findByRole('link', { name: 'Settings → Music' })).toBeTruthy();
  });

  it('says when nothing was played', async () => {
    streamMock.mockResolvedValue({ bucket: 'month', genres: [], buckets: [], plays: 0, plays_with_genres: 0 });
    renderChart();
    expect(await screen.findByText('Nothing played in this period.')).toBeTruthy();
  });

  it('says when it failed', async () => {
    streamMock.mockRejectedValue(new Error('boom'));
    renderChart();
    await waitFor(() => expect(screen.getByText("Couldn't load genres.")).toBeTruthy());
  });
});
