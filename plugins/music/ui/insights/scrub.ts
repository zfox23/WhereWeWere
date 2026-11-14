/**
 * Hover and finger-scrub for charts, the same way the weather chart does it:
 * a mouse highlights what it hovers and clears on leaving; touch and pen
 * highlight only while pressed (sliding along the chart follows the finger)
 * and clear when lifted. Vertical swipes still scroll the page.
 */

import type { CSSProperties, PointerEvent } from 'react';

export interface ScrubHandlers<E extends Element> {
  onPointerDown: (e: PointerEvent<E>) => void;
  onPointerMove: (e: PointerEvent<E>) => void;
  onPointerLeave: (e: PointerEvent<E>) => void;
  onPointerUp: (e: PointerEvent<E>) => void;
  onPointerCancel: (e: PointerEvent<E>) => void;
  style: CSSProperties;
}

/** `pick` maps a pointer to what's under it (null for nothing); `set` receives it. */
export function scrubHandlers<E extends Element, T>(pick: (e: PointerEvent<E>) => T | null, set: (v: T | null) => void): ScrubHandlers<E> {
  const follow = (e: PointerEvent<E>) => {
    const v = pick(e);
    if (v != null) set(v);
  };
  return {
    onPointerDown: follow,
    onPointerMove: (e) => {
      if (e.pointerType !== 'mouse' && e.buttons === 0) return;
      follow(e);
    },
    onPointerLeave: (e) => {
      if (e.pointerType === 'mouse') set(null);
    },
    onPointerUp: (e) => {
      if (e.pointerType !== 'mouse') set(null);
    },
    onPointerCancel: (e) => {
      if (e.pointerType !== 'mouse') set(null);
    },
    style: { touchAction: 'pan-y' },
  };
}

/** Which of `count` equal-width columns the pointer is over. */
export function columnAt(e: PointerEvent<Element>, count: number): number | null {
  const box = e.currentTarget.getBoundingClientRect();
  if (!box.width || count === 0) return null;
  const i = Math.floor(((e.clientX - box.left) / box.width) * count);
  return i >= 0 && i < count ? i : null;
}
