import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlackoutScreen, DOUBLE_TAP_MS, DOUBLE_TAP_PX, isDoubleTap } from '../ui/audio/BlackoutScreen';

describe('isDoubleTap', () => {
  const tap = (t: number, x = 100, y = 100) => ({ t, x, y });
  it('needs two taps close in time and place', () => {
    expect(isDoubleTap(null, tap(0))).toBe(false);
    expect(isDoubleTap(tap(0), tap(DOUBLE_TAP_MS))).toBe(true);
    expect(isDoubleTap(tap(0), tap(DOUBLE_TAP_MS + 1))).toBe(false);
    expect(isDoubleTap(tap(0), tap(100, 100 + DOUBLE_TAP_PX, 100))).toBe(true);
    expect(isDoubleTap(tap(0), tap(100, 100 + DOUBLE_TAP_PX + 1, 100))).toBe(false);
    expect(isDoubleTap(tap(500), tap(100))).toBe(false); // out of order
  });
});

describe('BlackoutScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const screenEl = () => screen.getByTestId('blackout-screen');

  it('covers the whole viewport in black, above everything, and is reachable by assistive tech', () => {
    render(<BlackoutScreen onExit={vi.fn()} />);
    const el = screenEl();
    expect(el.parentElement).toBe(document.body); // a portal, so no ancestor can clip it
    expect(el.style.position).toBe('fixed');
    expect(el.style.zIndex).toBe('2147483647');
    expect(el.style.background).toMatch(/^(#000|rgb\(0, 0, 0\))$/);
    expect(el.style.touchAction).toBe('manipulation'); // a double tap must not become a browser zoom
    expect(el).toHaveAttribute('role', 'dialog');
    expect(el).toHaveAccessibleName(/Double-tap to return/);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('returns on a double tap, not on one', () => {
    const onExit = vi.fn();
    render(<BlackoutScreen onExit={onExit} />);
    fireEvent.click(screenEl(), { clientX: 50, clientY: 50 });
    expect(onExit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    fireEvent.click(screenEl(), { clientX: 55, clientY: 52 });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('does not return for two slow taps, or two taps far apart', () => {
    const onExit = vi.fn();
    render(<BlackoutScreen onExit={onExit} />);
    fireEvent.click(screenEl(), { clientX: 50, clientY: 50 });
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 100);
    fireEvent.click(screenEl(), { clientX: 50, clientY: 50 });
    vi.advanceTimersByTime(100);
    fireEvent.click(screenEl(), { clientX: 400, clientY: 400 });
    expect(onExit).not.toHaveBeenCalled();
  });

  it('needs a fresh pair after a double tap: three quick taps return once', () => {
    const onExit = vi.fn();
    render(<BlackoutScreen onExit={onExit} />);
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screenEl(), { clientX: 10, clientY: 10 });
      vi.advanceTimersByTime(50);
    }
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('returns on Escape for keyboard users', () => {
    const onExit = vi.fn();
    render(<BlackoutScreen onExit={onExit} />);
    fireEvent.keyDown(screenEl(), { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screenEl(), { key: 'a' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('shows how to leave for a few seconds, then goes fully dark, and restores scrolling when closed', () => {
    const { unmount } = render(<BlackoutScreen onExit={vi.fn()} />);
    const hint = screen.getByText(/Double-tap to return/, { selector: 'p' });
    expect(hint).toHaveStyle({ opacity: '1' });
    act(() => { vi.advanceTimersByTime(3100); });
    expect(hint).toHaveStyle({ opacity: '0' });
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(screen.queryByTestId('blackout-screen')).toBeNull();
  });
});
