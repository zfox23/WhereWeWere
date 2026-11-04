import { createContext, useCallback, useContext, useState, useEffect, useMemo, useRef, ReactNode } from 'react';
import { DEFAULT_APPEARANCE, normalizeAppearance, pickValidAppearance, type Appearance } from 'wwp-shared';
import { settings } from '../api/client';
import { safeGetItem, safeRemoveItem, safeSetItem } from '../utils/storage';
import { loadFontPairing } from '../appearance';
import {
  DEFAULT_THEME_BY_MODE,
  SYSTEM_THEME_ID,
  applyThemeToRoot,
  applyAppearanceToRoot,
  readAppearanceAttrs,
  getResolvedThemeMode,
  resolveAppThemeId,
  normalizeThemePreference,
  resolveThemePreference,
  type AppThemeId,
  type ThemeMode,
  type ThemePreference,
} from '../themes';

/** How long appearance changes are batched before being saved to the server. */
export const APPEARANCE_SYNC_DELAY_MS = 400;

const APPEARANCE_STORAGE_KEY = 'appearance';
// Before appearance synced to the account, these two lived only in the browser.
const LEGACY_BG_PATTERN_KEY = 'bg-pattern';
const LEGACY_BG_GRADIENT_KEY = 'bg-gradient';

function dropLegacyAppearanceKeys() {
  safeRemoveItem(LEGACY_BG_PATTERN_KEY);
  safeRemoveItem(LEGACY_BG_GRADIENT_KEY);
}

/**
 * Appearance remembered by this browser, used until the account's copy
 * loads: the cached synced copy, or else the legacy browser-only background
 * keys. `legacy` holds only the latter: the values to move up to the account.
 */
function readLocalAppearance(): { appearance: Appearance; legacy: Partial<Appearance> } {
  let parsed: unknown = null;
  try {
    const raw = safeGetItem(APPEARANCE_STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const cached = pickValidAppearance(parsed);
  const legacy = pickValidAppearance({
    bgPattern: safeGetItem(LEGACY_BG_PATTERN_KEY),
    bgGradient: safeGetItem(LEGACY_BG_GRADIENT_KEY),
  });
  const appearance = normalizeAppearance(Object.keys(cached).length > 0 ? cached : legacy);
  return { appearance, legacy };
}

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  systemThemeSelection: Record<ThemeMode, AppThemeId>;
  resolvedTheme: ThemeMode;
  resolvedThemeId: AppThemeId;
  /** Display knobs other than the palette theme; synced to the account. */
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
  /** Restore every appearance knob to its default (the theme is kept). */
  resetAppearance: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: SYSTEM_THEME_ID,
  setTheme: () => {},
  systemThemeSelection: DEFAULT_THEME_BY_MODE,
  resolvedTheme: 'light',
  resolvedThemeId: DEFAULT_THEME_BY_MODE.light,
  appearance: DEFAULT_APPEARANCE,
  setAppearance: () => {},
  resetAppearance: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemTheme(): ThemeMode {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    const stored = normalizeThemePreference(safeGetItem('theme'));
    return stored || SYSTEM_THEME_ID;
  });
  const [systemThemeSelection, setSystemThemeSelectionState] = useState<Record<ThemeMode, AppThemeId>>(() => ({
    light: resolveAppThemeId(safeGetItem('system-light-theme'), DEFAULT_THEME_BY_MODE.light),
    dark: resolveAppThemeId(safeGetItem('system-dark-theme'), DEFAULT_THEME_BY_MODE.dark),
  }));
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(getSystemTheme);

  const [initialLocal] = useState(readLocalAppearance);
  const [appearance, setAppearanceState] = useState<Appearance>(initialLocal.appearance);
  // Changes not yet sent to the server, flushed after APPEARANCE_SYNC_DELAY_MS.
  const pendingAppearance = useRef<Partial<Appearance>>({});
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set once the user changes something here, so a slow initial server load
  // can't overwrite a choice they just made.
  const appearanceTouched = useRef(false);

  const flushAppearance = useCallback(() => {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
    const patch = pendingAppearance.current;
    pendingAppearance.current = {};
    if (Object.keys(patch).length > 0) {
      settings.update({ appearance: patch }).catch(() => {});
    }
  }, []);

  const queueAppearanceSync = useCallback((patch: Partial<Appearance>) => {
    pendingAppearance.current = { ...pendingAppearance.current, ...patch };
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(flushAppearance, APPEARANCE_SYNC_DELAY_MS);
  }, [flushAppearance]);

  // Don't drop a pending change when the page closes or the provider unmounts.
  useEffect(() => {
    window.addEventListener('pagehide', flushAppearance);
    return () => {
      window.removeEventListener('pagehide', flushAppearance);
      flushAppearance();
    };
  }, [flushAppearance]);

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Load theme from server on mount
  useEffect(() => {
    settings.get().then((s) => {
      const normalizedTheme = normalizeThemePreference(s.theme);
      if (normalizedTheme) {
        setThemeState(normalizedTheme);
        safeSetItem('theme', normalizedTheme);
      }

      const nextSystemThemeSelection = {
        light: resolveAppThemeId(s.system_light_theme, DEFAULT_THEME_BY_MODE.light),
        dark: resolveAppThemeId(s.system_dark_theme, DEFAULT_THEME_BY_MODE.dark),
      };

      setSystemThemeSelectionState(nextSystemThemeSelection);
      safeSetItem('system-light-theme', nextSystemThemeSelection.light);
      safeSetItem('system-dark-theme', nextSystemThemeSelection.dark);

      if (appearanceTouched.current) return;
      const fromServer = pickValidAppearance(s.appearance);
      if (Object.keys(fromServer).length === 0 && Object.keys(initialLocal.legacy).length > 0) {
        // One-time move of browser-only choices (from before appearance
        // synced) up to the account, so other devices pick them up. Only the
        // legacy keys: an empty account appearance otherwise means defaults
        // (e.g. after Start Over), which a cached copy must not undo.
        const next = normalizeAppearance(initialLocal.legacy);
        setAppearanceState(next);
        safeSetItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
        // Keep the legacy keys until the account has them, so a failed save
        // is retried on the next load.
        settings.update({ appearance: initialLocal.legacy }).then(dropLegacyAppearanceKeys, () => {});
      } else {
        // The account's appearance wins over whatever this browser cached.
        const next = normalizeAppearance(fromServer);
        setAppearanceState(next);
        safeSetItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
        // Any legacy keys are stale now (the account already decided).
        dropLegacyAppearanceKeys();
      }
    }).catch(() => {});
    // Runs once on mount; initialLocal never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolvedThemeId = resolveThemePreference(theme, systemTheme, systemThemeSelection);
  const resolvedTheme = getResolvedThemeMode(resolvedThemeId);

  // Apply the resolved palette and dark mode class to the document.
  useEffect(() => {
    const root = document.documentElement;
    applyThemeToRoot(root, resolvedThemeId);
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [resolvedTheme, resolvedThemeId]);

  // Apply appearance knobs as data attributes on <html>.
  useEffect(() => {
    applyAppearanceToRoot(document.documentElement, appearance);
  }, [appearance]);

  // Download the chosen font pairing (only Classic ships in the bundle).
  useEffect(() => {
    void loadFontPairing(appearance.font);
  }, [appearance.font]);

  // Remember what was applied so the inline script in index.html can restore
  // it before first paint on the next load (no light flash for dark themes).
  // Declared after the two effects above so it snapshots their result.
  useEffect(() => {
    const root = document.documentElement;
    safeSetItem(
      'theme-snapshot',
      JSON.stringify({
        dark: root.classList.contains('dark'),
        style: root.getAttribute('style') || '',
        theme: root.dataset.theme || '',
        attrs: readAppearanceAttrs(root),
      })
    );
  }, [resolvedTheme, resolvedThemeId, appearance]);

  const setTheme = (newTheme: ThemePreference) => {
    const nextSystemThemeSelection = newTheme === SYSTEM_THEME_ID
      ? systemThemeSelection
      : {
          ...systemThemeSelection,
          [getResolvedThemeMode(newTheme)]: newTheme,
        };

    setThemeState(newTheme);
    safeSetItem('theme', newTheme);
    setSystemThemeSelectionState(nextSystemThemeSelection);
    safeSetItem('system-light-theme', nextSystemThemeSelection.light);
    safeSetItem('system-dark-theme', nextSystemThemeSelection.dark);

    // Persist both the active theme and the remembered system pairings.
    settings.update({
      theme: newTheme,
      system_light_theme: nextSystemThemeSelection.light,
      system_dark_theme: nextSystemThemeSelection.dark,
    }).catch(() => {});
  };

  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    appearanceTouched.current = true;
    setAppearanceState((prev) => {
      const next = { ...prev, ...patch };
      safeSetItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    queueAppearanceSync(patch);
  }, [queueAppearanceSync]);

  const resetAppearance = useCallback(() => {
    setAppearance(DEFAULT_APPEARANCE);
  }, [setAppearance]);

  // Stable identity between renders so context consumers only re-render when
  // a theme value actually changes.
  const value = useMemo(
    () => ({ theme, setTheme, systemThemeSelection, resolvedTheme, resolvedThemeId, appearance, setAppearance, resetAppearance }),
    // setTheme closes over state already listed here; the others are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, systemThemeSelection, resolvedTheme, resolvedThemeId, appearance]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
