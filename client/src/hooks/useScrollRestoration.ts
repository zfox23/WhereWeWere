import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Window scroll positions by history entry (React Router's `location.key`,
 * which a Back/Forward brings back). Module-level so it outlives the pages,
 * which Layout remounts on every route change.
 */
const positions = new Map<string, number>();
const MAX_POSITIONS = 200;

function remember(key: string, y: number): void {
  positions.delete(key);
  positions.set(key, y);
  if (positions.size > MAX_POSITIONS) positions.delete(positions.keys().next().value as string);
}

/**
 * Put the window back where it was when the user returns to this history
 * entry with Back/Forward. `ready` should turn true once the content that
 * gives the page its height is on screen (restoring earlier would be clamped
 * to a shorter page).
 *
 * Positions are recorded as the user scrolls, so they are right even when one
 * mounted page moves between entries (one album page to another).
 */
export function useScrollRestoration(ready = true): void {
  const { key } = useLocation();
  const navigationType = useNavigationType();
  const keyRef = useRef(key);
  const handled = useRef<string | null>(null);

  useLayoutEffect(() => {
    // A replaced entry (a filter or chart setting changed in the URL) is the
    // same view: it keeps the window where it is, so Back returns there too.
    if (navigationType === 'REPLACE' && keyRef.current !== key) remember(key, window.scrollY);
    keyRef.current = key;
  }, [key, navigationType]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        remember(keyRef.current, window.scrollY);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useLayoutEffect(() => {
    if (!ready || handled.current === key) return;
    const firstEntry = handled.current === null;
    handled.current = key;
    const saved = positions.get(key);
    if (navigationType === 'POP' && saved != null) window.scrollTo(0, saved);
    // A new entry shown by the same mounted page (another album) starts at the
    // top, like a new page. A replaced one stays put.
    else if (!firstEntry && navigationType === 'PUSH') window.scrollTo(0, 0);
  }, [key, ready, navigationType]);
}

/** For tests. */
export function resetScrollPositions(): void {
  positions.clear();
}
