/**
 * Tiny pub/sub so module-level settings caches (Immich enabled, distance unit)
 * can drop their memoized value when settings are saved, instead of staying
 * stale until a full page reload.
 */
const target = new EventTarget();
const EVENT = 'wwp:settings-changed';

export function notifySettingsChanged(): void {
  target.dispatchEvent(new Event(EVENT));
}

/** Subscribe to settings changes; returns the unsubscribe function. */
export function onSettingsChanged(listener: () => void): () => void {
  target.addEventListener(EVENT, listener);
  return () => target.removeEventListener(EVENT, listener);
}
