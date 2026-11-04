/**
 * localStorage wrappers that never throw. Storage can be unavailable or throw
 * (private windows, blocked site data, quota); callers treat it as a best-effort
 * cache and fall back to defaults.
 */

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable or full: the preference just won't persist locally
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage unavailable: nothing to remove
  }
}
