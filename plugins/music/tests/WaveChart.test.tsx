import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaveChart, chooseBucket, clampView, groupWave, resetZoomHint, type WaveSeries } from '../ui/insights/WaveChart';

/** Two bands over all of 2023 and 2024 (731 days), a play a day each, more on the first of each month. */
function twoYears(): WaveSeries {
  const n = 731;
  const day = (i: number) => new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);
  return {
    first: '2023-01-01',
    names: ['A', 'B'],
    bands: [
      Array.from({ length: n }, (_, i) => (day(i).endsWith('-01') ? 5 : 1)),
      Array.from({ length: n }, () => 1),
    ],
    other: Array.from({ length: n }, () => 0),
  };
}

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

const renderWave = (series = twoYears(), base: 'year' | 'month' | 'week' = 'month') =>
  render(
    <MemoryRouter>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <WaveChart
                series={series}
                base={base}
                caption={(g) => `Plays per ${g}`}
                ariaLabel={(g) => `Wave per ${g}`}
                otherLabel="Other"
                bandHref={(i) => `/band/${i}`}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const sized = (svg: Element) => {
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 200, right: 600, bottom: 200, x: 0, y: 0, toJSON: () => ({}) });
  return svg;
};
const axis = () => screen.getByLabelText('Showing').textContent;
const chart = () => sized(screen.getByRole('img', { name: /^Wave per/ }));
const ctrlWheel = (svg: Element, x: number, deltaY: number) =>
  act(() => {
    svg.dispatchEvent(new WheelEvent('wheel', { clientX: x, deltaY, ctrlKey: true, bubbles: true, cancelable: true }));
  });

afterEach(cleanup);

describe('groupWave', () => {
  it('groups days by month, each with its middle', () => {
    const g = groupWave(twoYears(), 'month');
    expect(g.ranges).toHaveLength(24);
    expect(g.ranges[0]).toEqual({ start: '2023-01-01', end: '2023-01-31' });
    expect(g.data.buckets[0].counts).toEqual([35, 31]);
    expect(g.centers[1] - g.centers[0]).toBeCloseTo(29.5);
  });
});

describe('chooseBucket', () => {
  it('keeps the chosen grouping while there are enough groups, and goes finer when there are not', () => {
    expect(chooseBucket('month', 731)).toBe('month');
    expect(chooseBucket('month', 120)).toBe('week');
    expect(chooseBucket('month', 40)).toBe('day');
    expect(chooseBucket('year', 3000)).toBe('year');
    expect(chooseBucket('year', 1000)).toBe('month');
    // Never coarser than chosen.
    expect(chooseBucket('week', 3000)).toBe('week');
  });
});

describe('clampView', () => {
  it('keeps a view inside the range and no narrower than two weeks', () => {
    expect(clampView(-50, 100, 0, 700)).toEqual({ t0: 0, t1: 100 });
    expect(clampView(650, 100, 0, 700)).toEqual({ t0: 600, t1: 700 });
    expect(clampView(10, 3, 0, 700)).toEqual({ t0: 10, t1: 24 });
  });

  it('is the full view once it covers the whole range', () => {
    expect(clampView(0, 700, 0, 700)).toBeNull();
    expect(clampView(-100, 5000, 0, 700)).toBeNull();
  });
});

describe('WaveChart zoom and pan', () => {
  beforeEach(() => resetZoomHint());

  it('zooms around the pointer with Ctrl + scroll, going finer, and back out to the full view', () => {
    renderWave();
    const svg = chart();
    expect(axis()).toBe('Jan 2023Dec 2024');
    // In, around the middle, to about 160 days: fewer than eight months in view, so weeks.
    ctrlWheel(svg, 300, -150);
    expect(screen.getByText('Plays per week')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Wave per week' })).toBeTruthy();
    const zoomed = axis()!;
    expect(zoomed).not.toBe('Jan 2023Dec 2024');
    expect(zoomed).toMatch(/2023|2024/);
    // Further, to the two-week minimum: days.
    ctrlWheel(svg, 300, -400);
    expect(screen.getByText('Plays per day')).toBeTruthy();
    // All the way out: the full view again.
    ctrlWheel(svg, 300, 2000);
    expect(screen.getByText('Plays per month')).toBeTruthy();
    expect(axis()).toBe('Jan 2023Dec 2024');
  });

  it('lets a plain scroll scroll the page, with a hint once', () => {
    renderWave();
    const svg = chart();
    const plain = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    act(() => {
      svg.dispatchEvent(plain);
    });
    expect(plain.defaultPrevented).toBe(false);
    expect(screen.getByRole('note').textContent).toMatch(/scroll, or pinch, to zoom/);
    expect(axis()).toBe('Jan 2023Dec 2024');
  });

  it('pans with a mouse drag when zoomed, and a drag doesn\'t open a band', () => {
    renderWave();
    const svg = chart();
    ctrlWheel(svg, 0, -400); // zoomed in at the start
    const before = axis();
    fireEvent.pointerDown(svg, { clientX: 400, clientY: 100, pointerType: 'mouse', button: 0, buttons: 1 });
    fireEvent.pointerMove(svg, { clientX: 100, clientY: 100, pointerType: 'mouse', buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 100, clientY: 100, pointerType: 'mouse' });
    expect(axis()).not.toBe(before);
    fireEvent.click(svg.querySelectorAll('path')[0]);
    expect(screen.getByTestId('where').textContent).toBe('/');
    // A click without a drag still opens it.
    fireEvent.pointerDown(svg, { clientX: 300, clientY: 100, pointerType: 'mouse', button: 0, buttons: 1 });
    fireEvent.pointerUp(svg, { clientX: 300, clientY: 100, pointerType: 'mouse' });
    fireEvent.click(svg.querySelectorAll('path')[0]);
    expect(screen.getByTestId('where').textContent).toBe('/band/0');
  });

  it('can\'t pan the full view', () => {
    renderWave();
    const svg = chart();
    fireEvent.pointerDown(svg, { clientX: 400, clientY: 100, pointerType: 'mouse', button: 0, buttons: 1 });
    fireEvent.pointerMove(svg, { clientX: 100, clientY: 100, pointerType: 'mouse', buttons: 1 });
    expect(axis()).toBe('Jan 2023Dec 2024');
  });

  it('pinches with two fingers, while one finger still opens the popup', () => {
    renderWave();
    const svg = chart();
    fireEvent.pointerDown(svg, { pointerId: 1, clientX: 300, clientY: 100, pointerType: 'touch', buttons: 1 });
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.pointerDown(svg, { pointerId: 2, clientX: 320, clientY: 100, pointerType: 'touch', buttons: 1 });
    // A second finger closes the popup; spreading them zooms in.
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.pointerMove(svg, { pointerId: 2, clientX: 520, clientY: 100, pointerType: 'touch', buttons: 1 });
    expect(axis()).not.toBe('Jan 2023Dec 2024');
    fireEvent.pointerUp(svg, { pointerId: 1, pointerType: 'touch' });
    fireEvent.pointerUp(svg, { pointerId: 2, pointerType: 'touch' });
  });

  it('starts at the full view again when the grouping changes', () => {
    const { rerender } = renderWave();
    ctrlWheel(chart(), 300, -400);
    expect(axis()).not.toBe('Jan 2023Dec 2024');
    rerender(
      <MemoryRouter>
        <WaveChart series={twoYears()} base="year" caption={(g) => `Plays per ${g}`} ariaLabel={(g) => `Wave per ${g}`} otherLabel="Other" />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Showing').textContent).toBe('20232024');
  });
});
