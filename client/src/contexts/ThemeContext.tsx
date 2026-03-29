import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { settings } from '../api/client';

type ThemePref = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemePref;
  setTheme: (theme: ThemePref) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  resolvedTheme: 'light',
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>(() => {
    const stored = localStorage.getItem('theme') as ThemePref | null;
    return stored || 'system';
  });
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme);

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
      if (s.theme && ['system', 'light', 'dark'].includes(s.theme)) {
        setThemeState(s.theme);
        localStorage.setItem('theme', s.theme);
      }
    }).catch(() => {});
  }, []);

  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  // Apply dark class to document
  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [resolvedTheme]);

  const setTheme = (newTheme: ThemePref) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    // Persist to server
    settings.update({ theme: newTheme }).catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
