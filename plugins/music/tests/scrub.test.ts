import { describe, expect, it, vi } from 'vitest';
import { columnAt, scrubHandlers } from '../ui/insights/scrub';

const ev = (pointerType: string, buttons = 0, clientX = 50) =>
  ({
    pointerType,
    buttons,
    clientX,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) },
  }) as any;

describe('chart scrubbing', () => {
  it('follows a hovering mouse and clears when it leaves', () => {
    const set = vi.fn();
    const h = scrubHandlers((e) => columnAt(e, 4), set);
    h.onPointerMove(ev('mouse', 0, 80));
    expect(set).toHaveBeenLastCalledWith(3);
    h.onPointerUp(ev('mouse'));
    expect(set).toHaveBeenCalledTimes(1);
    h.onPointerLeave(ev('mouse'));
    expect(set).toHaveBeenLastCalledWith(null);
  });

  it('follows a finger only while pressed, and clears when it lifts', () => {
    const set = vi.fn();
    const h = scrubHandlers((e) => columnAt(e, 4), set);
    h.onPointerMove(ev('touch', 0, 10));
    expect(set).not.toHaveBeenCalled();
    h.onPointerDown(ev('touch', 1, 10));
    h.onPointerMove(ev('touch', 1, 60));
    expect(set.mock.calls.map((c) => c[0])).toEqual([0, 2]);
    h.onPointerLeave(ev('touch'));
    expect(set).toHaveBeenCalledTimes(2);
    h.onPointerUp(ev('touch'));
    expect(set).toHaveBeenLastCalledWith(null);
    expect(h.style.touchAction).toBe('pan-y');
  });

  it('ignores positions outside the chart', () => {
    expect(columnAt(ev('mouse', 0, 100), 4)).toBeNull();
    expect(columnAt(ev('mouse', 0, -1), 4)).toBeNull();
  });
});
