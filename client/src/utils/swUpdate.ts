/**
 * Applying a service-worker update means reloading the page, which throws away
 * anything the user is in the middle of typing. These helpers let the app wait
 * for a quiet moment instead of reloading the instant a new build lands.
 */

/** True while the user could lose input by reloading (a form page, or a field with focus). */
export function isUserEditing(pathname: string, search: string, active: Element | null): boolean {
  if (/check-in/i.test(pathname) || new URLSearchParams(search).has('edit')) return true;
  if (!active) return false;
  const tag = active.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (active as HTMLElement).isContentEditable === true
  );
}

/**
 * Run `reload` as soon as the user isn't editing. Checks immediately and then
 * every `intervalMs`. Returns a cancel function.
 */
export function reloadWhenIdle(
  reload: () => void,
  isEditing: () => boolean,
  intervalMs = 3000
): () => void {
  if (!isEditing()) {
    reload();
    return () => {};
  }
  const timer = setInterval(() => {
    if (!isEditing()) {
      clearInterval(timer);
      reload();
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
