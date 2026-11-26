import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenreWaveChart, basisPath, layoutWave, momentRows } from '../ui/insights/GenreWaveChart';
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
  other: { plays: 3, genres: 2, top: [{ name: 'ambient', plays: 2 }, { name: 'techno', plays: 1 }] },
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
  it('stacks the genre bands around a centre line, leaving Other out', () => {
    const { bands, xs, y } = layoutWave(STREAM, 600, 200);
    expect(xs).toEqual([0, 300, 600]);
    expect(bands).toHaveLength(2);
    // Eight genre plays in January: from -4 to +4, trance at the bottom.
    expect(bands[0]).toEqual({ lo: [-4, -2, -3], hi: [2, -2, 0] });
    expect(bands[1]).toEqual({ lo: [2, -2, 0], hi: [4, 2, 3] });
    // The thickest bucket spans the height, less a small margin; 0 is the middle.
    expect(y(0)).toBe(100);
    expect(y(4) - y(-4)).toBeCloseTo(-192);
  });
});

describe('momentRows', () => {
  const many = {
    genres: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    buckets: [{ start: '2024-01-01', counts: [8, 7, 6, 5, 4, 3, 2, 0], other: 5, other_top: [] }],
  };

  it('lists the biggest genres of the moment, sums the rest, and skips those with no plays', () => {
    const m = momentRows(many, 0, null);
    expect(m.total).toBe(40);
    expect(m.rows.map((r) => r.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(m.rest).toBe(10);
  });

  it('always lists the hovered genre', () => {
    const m = momentRows(many, 0, 6);
    expect(m.rows.map((r) => r.name)).toEqual(['a', 'b', 'c', 'd', 'g']);
    expect(m.rest).toBe(12);
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

  it('draws a band per top genre, with no legend or table, and sums Other below the chart', async () => {
    renderChart();
    const chart = await screen.findByRole('img', { name: 'Plays per month of the top genres' });
    expect(streamMock).toHaveBeenCalledWith('2024-01-01', '2024-03-31');
    expect(chart.querySelectorAll('path')).toHaveLength(2);
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/75% of plays have genres/)).toBeTruthy();
    expect(screen.getByText('Jan 2024')).toBeTruthy();
    expect(screen.getByText('Mar 2024')).toBeTruthy();
    const other = screen.getByText(/Other genres, not drawn/);
    expect(other.textContent).toBe('Other genres, not drawn: 3 plays across 2 more genres (most: ambient 2, techno 1).');
    expect(within(other).getByRole('link', { name: 'ambient' }).getAttribute('href')).toBe('/music/genre?name=ambient');
  });

  it('leaves out the Other line when every genre has a band', async () => {
    streamMock.mockResolvedValue({ ...STREAM, other: { plays: 0, genres: 0, top: [] } });
    renderChart();
    await screen.findByRole('img', { name: 'Plays per month of the top genres' });
    expect(screen.queryByText(/Other genres, not drawn/)).toBeNull();
  });

  it('pops up the moment\'s mix beside the crosshair, on the side with room', async () => {
    renderChart();
    const svg = await screen.findByRole('img', { name: 'Plays per month of the top genres' });
    expect(screen.queryByRole('status')).toBeNull();
    // January, near the bottom: trance, which is highlighted in the popup.
    hover(svg, 0, 0.9);
    let popup = screen.getByRole('status');
    expect(popup.textContent).toContain('Jan 2024');
    const rows = within(popup).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual(['trance6 · 60%', 'house2 · 20%', 'Other genres2 · 20%']);
    expect(rows[0].className).toContain('font-semibold');
    expect(rows[1].className).not.toContain('font-semibold');
    expect(popup.style.left).toBe('calc(0% + 10px)');
    // March, at the right edge: the popup sits to the left of the crosshair.
    hover(svg, 1, 0.01);
    popup = screen.getByRole('status');
    expect(popup.textContent).toContain('Mar 2024');
    expect(popup.style.right).toBe('calc(0% + 10px)');
    expect(popup.style.left).toBe('');
    // Between bands nothing is highlighted.
    expect(within(popup).getAllByRole('listitem').some((r) => r.className.includes('font-semibold'))).toBe(false);
    fireEvent.pointerLeave(svg, { pointerType: 'mouse' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('follows a finger only while it is held down', async () => {
    renderChart();
    const svg = await screen.findByRole('img', { name: 'Plays per month of the top genres' });
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 200, right: 600, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerDown(svg, { clientX: 300, clientY: 100, pointerType: 'touch', buttons: 1 });
    expect(screen.getByRole('status').textContent).toContain('Feb 2024');
    fireEvent.pointerUp(svg, { pointerType: 'touch' });
    expect(screen.queryByRole('status')).toBeNull();
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
