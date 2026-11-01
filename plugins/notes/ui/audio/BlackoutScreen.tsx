/**
 * A fully black screen to cover the app while recording (a phone in a pocket or
 * on a table, a dark room, an OLED panel left lit for an hour). The recording
 * carries on underneath and the screen wake lock stays held; double-tap (or
 * double-click) anywhere to bring the app back. Escape works too, for keyboards.
 *
 * It is deliberately blank: a faint hint shows for a few seconds so you know
 * how to leave, then fades out. It renders in a portal so no ancestor's
 * transform or backdrop filter can stop it covering the whole viewport.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Two taps this close in time and place make a double tap. */
export const DOUBLE_TAP_MS = 400;
export const DOUBLE_TAP_PX = 60;
const HINT_MS = 3000;

export interface Tap {
  t: number;
  x: number;
  y: number;
}

export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (!prev) return false;
  const dt = next.t - prev.t;
  return dt >= 0 && dt <= DOUBLE_TAP_MS && Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX;
}

export function BlackoutScreen({ onExit }: { onExit: () => void }) {
  const lastTap = useRef<Tap | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState(true);

  useEffect(() => {
    root.current?.focus();
    const timer = setTimeout(() => setHint(false), HINT_MS);
    // Nothing behind the overlay should scroll or be reachable.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = overflow;
    };
  }, []);

  const onClick = (e: React.MouseEvent) => {
    const tap: Tap = { t: Date.now(), x: e.clientX || 0, y: e.clientY || 0 };
    if (isDoubleTap(lastTap.current, tap)) {
      lastTap.current = null;
      onExit();
    } else {
      lastTap.current = tap;
    }
  };

  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Screen blanked while recording. Double-tap to return."
      tabIndex={-1}
      data-testid="blackout-screen"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onExit();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="select-none outline-none"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: '#000',
        cursor: 'none',
        // No browser double-tap zoom: both taps must reach us.
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: '2.5rem',
      }}
    >
      {/* Dark grey on black: readable up close, barely lights the room. */}
      <p aria-hidden="true" style={{ color: '#4b4b4b', fontSize: '0.875rem', opacity: hint ? 1 : 0, transition: 'opacity 1s' }}>
        Recording. Double-tap to return.
      </p>
    </div>,
    document.body,
  );
}
