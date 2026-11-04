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

/**
 * The hashed entry script an HTML shell loads (e.g. `/assets/index-abc123.js`).
 * Every build gets a new hash, so this names the build. Null if none is found.
 */
export function entryScriptPath(doc: Document, origin: string): string | null {
  const src = doc.querySelector('script[type="module"][src]')?.getAttribute('src');
  if (!src) return null;
  try {
    return new URL(src, origin).pathname;
  } catch {
    return null;
  }
}

/** The entry script named in an HTML string. */
export function entryScriptPathFromHtml(html: string, origin: string): string | null {
  return entryScriptPath(new DOMParser().parseFromString(html, 'text/html'), origin);
}

/**
 * Whether the page should reload to move from build `running` to the server's
 * `latest`. `lastAttempted` is the build a previous reload in this tab already
 * tried to reach. If the page is still not on it, that reload didn't land (e.g.
 * the shell came from the offline cache), so don't loop on it.
 */
export function shouldReloadForBuild(
  running: string | null,
  latest: string | null,
  lastAttempted: string | null
): boolean {
  return Boolean(running && latest && latest !== running && latest !== lastAttempted);
}
