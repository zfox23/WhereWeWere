/**
 * The user's Spotify status (app saved? signed in?), loaded once and shared by
 * every component that shows Spotify features; `refreshSpotifyStatus` reloads
 * it after a change in Settings.
 */

import { useEffect, useState } from 'react';
import { spotify } from './api';
import type { SpotifyStatus } from './types';

let cached: SpotifyStatus | null = null;
let pending: Promise<SpotifyStatus | null> | null = null;
const listeners = new Set<(s: SpotifyStatus | null) => void>();

function load(): Promise<SpotifyStatus | null> {
  pending ??= spotify
    .status()
    .catch(() => null)
    .then((s) => {
      cached = s;
      pending = null;
      for (const l of listeners) l(s);
      return s;
    });
  return pending;
}

export function refreshSpotifyStatus(): Promise<SpotifyStatus | null> {
  cached = null;
  return load();
}

/** For tests: forget the cached status. */
export function resetSpotifyStatusCache(): void {
  cached = null;
  pending = null;
}

/** The status, or null while it loads (or when it can't be loaded). */
export function useSpotifyStatus(): SpotifyStatus | null {
  const [status, setStatus] = useState<SpotifyStatus | null>(cached);
  useEffect(() => {
    listeners.add(setStatus);
    if (!cached) void load();
    else setStatus(cached);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return status;
}
