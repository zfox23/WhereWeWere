import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { settings } from '../api/client';
import {
  DEFAULT_THEME_BY_MODE,
  SYSTEM_THEME_ID,
  applyThemeToRoot,
  getResolvedThemeMode,
  resolveAppThemeId,
  normalizeThemePreference,
  resolveThemePreference,
  type AppThemeId,
  type ThemeMode,
  type ThemePreference,
} from '../themes';

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  systemThemeSelection: Record<ThemeMode, AppThemeId>;
  resolvedTheme: ThemeMode;
  resolvedThemeId: AppThemeId;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: SYSTEM_THEME_ID,
  setTheme: () => {},
  systemThemeSelection: DEFAULT_THEME_BY_MODE,
  resolvedTheme: 'light',
  resolvedThemeId: DEFAULT_THEME_BY_MODE.light,
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

  return (
    <ThemeContext.Provider value={{ theme, setTheme, systemThemeSelection, resolvedTheme, resolvedThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
}
