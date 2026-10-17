import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { settings } from '../api/client';
import { safeGetItem, safeSetItem } from '../utils/storage';
import {
  DEFAULT_THEME_BY_MODE,
  SYSTEM_THEME_ID,
  applyThemeToRoot,
  applyBgToRoot,
  getResolvedThemeMode,
  resolveAppThemeId,
  normalizeThemePreference,
  resolveThemePreference,
  BG_PATTERN_OPTIONS,
  BG_GRADIENT_OPTIONS,
  DEFAULT_BG_PATTERN,
  DEFAULT_BG_GRADIENT,
  type AppThemeId,
  type ThemeMode,
  type ThemePreference,
  type BgPatternId,
  type BgGradientId,
} from '../themes';

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  systemThemeSelection: Record<ThemeMode, AppThemeId>;
  resolvedTheme: ThemeMode;
  resolvedThemeId: AppThemeId;
  bgPattern: BgPatternId;
  setBgPattern: (pattern: BgPatternId) => void;
  bgGradient: BgGradientId;
  setBgGradient: (gradient: BgGradientId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: SYSTEM_THEME_ID,
  setTheme: () => {},
  systemThemeSelection: DEFAULT_THEME_BY_MODE,
  resolvedTheme: 'light',
  resolvedThemeId: DEFAULT_THEME_BY_MODE.light,
  bgPattern: DEFAULT_BG_PATTERN,
  setBgPattern: () => {},
  bgGradient: DEFAULT_BG_GRADIENT,
  setBgGradient: () => {},
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

  const [bgPattern, setBgPatternState] = useState<BgPatternId>(() => {
    const stored = safeGetItem('bg-pattern') as BgPatternId | null;
    return BG_PATTERN_OPTIONS.some(p => p.id === stored) ? stored! : DEFAULT_BG_PATTERN;
  });
  const [bgGradient, setBgGradientState] = useState<BgGradientId>(() => {
    const stored = safeGetItem('bg-gradient') as BgGradientId | null;
    return BG_GRADIENT_OPTIONS.some(g => g.id === stored) ? stored! : DEFAULT_BG_GRADIENT;
  });

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
    }).catch(() => {});
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

  // Apply background pattern and gradient data attributes.
  useEffect(() => {
    applyBgToRoot(document.documentElement, bgPattern, bgGradient);
  }, [bgPattern, bgGradient]);

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
        bgPattern: root.dataset.bgPattern || '',
        bgGradient: root.dataset.bgGradient || '',
      })
    );
  }, [resolvedTheme, resolvedThemeId, bgPattern, bgGradient]);

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

  const setBgPattern = (pattern: BgPatternId) => {
    setBgPatternState(pattern);
    safeSetItem('bg-pattern', pattern);
  };

  const setBgGradient = (gradient: BgGradientId) => {
    setBgGradientState(gradient);
    safeSetItem('bg-gradient', gradient);
  };

  // Stable identity between renders so context consumers only re-render when
  // a theme value actually changes.
  const value = useMemo(
    () => ({ theme, setTheme, systemThemeSelection, resolvedTheme, resolvedThemeId, bgPattern, setBgPattern, bgGradient, setBgGradient }),
    // setTheme/setBgPattern/setBgGradient close over state already listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, systemThemeSelection, resolvedTheme, resolvedThemeId, bgPattern, bgGradient]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
