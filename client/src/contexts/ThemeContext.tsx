import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { settings } from '../api/client';
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
    const stored = normalizeThemePreference(localStorage.getItem('theme'));
    return stored || SYSTEM_THEME_ID;
  });
  const [systemThemeSelection, setSystemThemeSelectionState] = useState<Record<ThemeMode, AppThemeId>>(() => ({
    light: resolveAppThemeId(localStorage.getItem('system-light-theme'), DEFAULT_THEME_BY_MODE.light),
    dark: resolveAppThemeId(localStorage.getItem('system-dark-theme'), DEFAULT_THEME_BY_MODE.dark),
  }));
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(getSystemTheme);

  const [bgPattern, setBgPatternState] = useState<BgPatternId>(() => {
    const stored = localStorage.getItem('bg-pattern') as BgPatternId | null;
    return BG_PATTERN_OPTIONS.some(p => p.id === stored) ? stored! : DEFAULT_BG_PATTERN;
  });
  const [bgGradient, setBgGradientState] = useState<BgGradientId>(() => {
    const stored = localStorage.getItem('bg-gradient') as BgGradientId | null;
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
        localStorage.setItem('theme', normalizedTheme);
      }

      const nextSystemThemeSelection = {
        light: resolveAppThemeId(s.system_light_theme, DEFAULT_THEME_BY_MODE.light),
        dark: resolveAppThemeId(s.system_dark_theme, DEFAULT_THEME_BY_MODE.dark),
      };

      setSystemThemeSelectionState(nextSystemThemeSelection);
      localStorage.setItem('system-light-theme', nextSystemThemeSelection.light);
      localStorage.setItem('system-dark-theme', nextSystemThemeSelection.dark);
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

  const setTheme = (newTheme: ThemePreference) => {
    const nextSystemThemeSelection = newTheme === SYSTEM_THEME_ID
      ? systemThemeSelection
      : {
          ...systemThemeSelection,
          [getResolvedThemeMode(newTheme)]: newTheme,
        };

    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    setSystemThemeSelectionState(nextSystemThemeSelection);
    localStorage.setItem('system-light-theme', nextSystemThemeSelection.light);
    localStorage.setItem('system-dark-theme', nextSystemThemeSelection.dark);

    // Persist both the active theme and the remembered system pairings.
    settings.update({
      theme: newTheme,
      system_light_theme: nextSystemThemeSelection.light,
      system_dark_theme: nextSystemThemeSelection.dark,
    }).catch(() => {});
  };

  const setBgPattern = (pattern: BgPatternId) => {
    setBgPatternState(pattern);
    localStorage.setItem('bg-pattern', pattern);
  };

  const setBgGradient = (gradient: BgGradientId) => {
    setBgGradientState(gradient);
    localStorage.setItem('bg-gradient', gradient);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, systemThemeSelection, resolvedTheme, resolvedThemeId, bgPattern, setBgPattern, bgGradient, setBgGradient }}>
      {children}
    </ThemeContext.Provider>
  );
}
