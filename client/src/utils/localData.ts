/**
 * Wipe what this browser holds of the signed-in user's data, so the next
 * person to sign in on the device (or anyone opening it) can't read it.
 * Run on sign-out, sign-out-everywhere, and whenever the session turns out
 * to be gone.
 *
 * Inventory of what the app stores on the device:
 * - CacheStorage 'api-cache': the service worker's copy of recent API
 *   responses (check-ins, venues, stats...). Private — deleted.
 * - localStorage 'wwp:notes:draft:*': unsaved note drafts (notes plugin).
 *   Private — deleted, along with every other key not listed below.
 * - sessionStorage: nothing today; cleared wholesale in case a plugin adds
 *   something.
 * - IndexedDB: nothing of the app's own; the service worker keeps cache
 *   expiry bookkeeping (cached API URLs) there — deleted.
 *
 * Kept: the pure device preferences in DEVICE_PREFERENCE_KEYS (theme and
 * background choice). They hold nothing about the user's data, and the login
 * screen itself is drawn with them.
 * Other caches (precached app shell, map tiles, Leaflet) hold no user data.
 */
export const DEVICE_PREFERENCE_KEYS: readonly string[] = [
  'theme',
  'system-light-theme',
  'system-dark-theme',
  'bg-pattern',
  'bg-gradient',
];

/** The service worker's runtime cache of API responses (see sw-custom.ts). */
export const API_CACHE_NAME = 'api-cache';

function clearLocalStorage(): void {
  try {
    const keep = new Set(DEVICE_PREFERENCE_KEYS);
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && !keep.has(key)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // storage unavailable: nothing stored to clear
  }
}

function clearSessionStorage(): void {
  try {
    sessionStorage.clear();
  } catch {
    // storage unavailable
  }
}

function clearIndexedDb(): void {
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return;
    // Fire and forget: a database the service worker holds open is deleted
    // once its connection closes; sign-out shouldn't wait on that.
    indexedDB
      .databases()
      .then((dbs) => {
        for (const db of dbs) if (db.name) indexedDB.deleteDatabase(db.name);
      })
      .catch(() => {});
  } catch {
    // IndexedDB unavailable
  }
}

async function clearApiCache(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    // Don't let a wedged CacheStorage hold up signing out.
    await Promise.race([
      caches.delete(API_CACHE_NAME),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch {
    // CacheStorage unavailable (e.g. insecure context): nothing cached
  }
}

/** Delete this device's cached private data, keeping only device preferences. */
export async function wipeLocalUserData(): Promise<void> {
  clearLocalStorage();
  clearSessionStorage();
  clearIndexedDb();
  await clearApiCache();
}
