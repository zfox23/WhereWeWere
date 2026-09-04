import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TrackGraph from '../../src/components/TrackGraph';

const coordinates: [number, number][] = [
  [0, 0],
  [0.001, 0],
  [0.002, 0],
];

const points = [
  { t: Date.UTC(2024, 0, 1, 10, 0, 0), ele: 10, hr: 100 },
  { t: Date.UTC(2024, 0, 1, 10, 0, 3), ele: 20, hr: 110 },
  { t: Date.UTC(2024, 0, 1, 10, 0, 7), ele: null, hr: 120 },
];

function renderGraph(onHoverPoint = vi.fn()) {
  return render(
    <TrackGraph
      coordinates={coordinates}
      points={points}
      distanceUnit="metric"
      onHoverPoint={onHoverPoint}
    />
  );
}

describe('TrackGraph', () => {
  afterEach(cleanup);

  it('renders with two series selected by default', () => {
    renderGraph();
    expect(screen.getByRole('button', { name: /speed/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /elevation/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: /heart rate/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('switches the x-axis between distance and time, with duration labels', async () => {
    const user = userEvent.setup();
    const { container } = renderGraph();
    const timeBtn = screen.getByRole('button', { name: 'time', hidden: true });
    await user.click(timeBtn);
    expect(timeBtn).toHaveAttribute('aria-pressed', 'true');
    const distanceBtn = screen.getByRole('button', { name: 'distance', hidden: true });
    expect(distanceBtn).toHaveAttribute('aria-pressed', 'false');

    // Time axis is elapsed duration: starts at 0 and uses shorthand labels
    const svgText = container.querySelector('svg[aria-label="Track graph"]')?.textContent ?? '';
    expect(svgText).toContain('0');
    expect(svgText).toContain('7s');
  });

  it('allows at most two series and at least one', async () => {
    const user = userEvent.setup();
    renderGraph();

    // Third series is blocked while two are active
    await user.click(screen.getByRole('button', { name: /heart rate/i }));
    expect(screen.getByRole('button', { name: /heart rate/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    // Dropping to one series works
    await user.click(screen.getByRole('button', { name: /speed/i }));
    expect(screen.getByRole('button', { name: /speed/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    // Adding a second series now works
    await user.click(screen.getByRole('button', { name: /heart rate/i }));
    expect(screen.getByRole('button', { name: /heart rate/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // The last remaining series cannot be deselected
    await user.click(screen.getByRole('button', { name: /heart rate/i }));
    await user.click(screen.getByRole('button', { name: /elevation/i }));
    expect(screen.getByRole('button', { name: /elevation/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('labels a longer time axis with shorthand durations (30m, 1h, ...)', async () => {
    const user = userEvent.setup();
    const base = Date.UTC(2024, 0, 1, 10, 0, 0);
    const { container } = render(
      <TrackGraph
        coordinates={coordinates}
        points={[
          { t: base, ele: 10, hr: 100 },
          { t: base + 5400_000, ele: 20, hr: 110 }, // 1h 30m
          { t: base + 7200_000, ele: 30, hr: 120 }, // 2h
        ]}
        distanceUnit="metric"
        onHoverPoint={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: 'time', hidden: true }));
    const svgText =
      container.querySelector('svg[aria-label="Track graph"]')?.textContent ?? '';
    expect(svgText).toContain('0');
    expect(svgText).toContain('30m');
    expect(svgText).toContain('1h');
    expect(svgText).toContain('1h 30m');
    expect(svgText).toContain('2h');
  });

  it('reports the nearest track point index on hover', () => {
    const onHoverPoint = vi.fn();
    const { container } = renderGraph(onHoverPoint);
    const overlay = container.querySelector('[data-testid="chart-overlay"]') as SVGRectElement | null;
    expect(overlay).toBeTruthy();

    // jsdom reports a zero rect; pointer at the left edge maps to index 0
    overlay.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: 48,
        clientY: 10,
        bubbles: true,
      })
    );
    expect(onHoverPoint).toHaveBeenCalledWith(0);

    // Pointer leave clears the hover (React emulates onPointerLeave from pointerout)
    overlay.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
    expect(onHoverPoint).toHaveBeenLastCalledWith(null);
  });
});
