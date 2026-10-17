import { useEffect, useState } from 'react';
import { settings } from '../api/client';
import { onSettingsChanged } from '../utils/settingsEvents';

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
      .catch(() => {
        // Don't memoize a failed load as "disabled": let the next caller retry.
        cached = null;
        return false;
      });
  }
  return cached;
}

// Registered at import time, so it runs before any hook instance's listener:
// the cache is already dropped when they reload.
onSettingsChanged(() => {
  cached = null;
});

export function useImmichEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () =>
      loadImmichEnabled().then((value) => {
        if (active) setEnabled(value);
      });
    load();
    // Saving the integration settings must take effect without a reload.
    const unsubscribe = onSettingsChanged(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return enabled;
}
