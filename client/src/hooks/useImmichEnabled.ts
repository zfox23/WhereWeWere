import { useEffect, useState } from 'react';
import { settings } from '../api/client';

/**
 * Whether the Immich integration is configured (has both a URL and an API
 * key). The settings fetch is memoized module-wide so every companion-name
 * photo on screen shares a single request.
 */
let cached: Promise<boolean> | null = null;

function loadImmichEnabled(): Promise<boolean> {
  if (!cached) {
    cached = settings
      .get()
      .then((s) => Boolean(s?.immich_url && s?.immich_api_key))
      .catch(() => false);
  }
  return cached;
}

export function useImmichEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    loadImmichEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return enabled;
}
