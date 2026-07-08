'use client';

// ── Theme provider (light/dark toggle) — client component ────────────────────
// Mirrors the I18nProvider pattern in i18n.tsx: default-render 'dark' on the
// server and on first client paint (matches the existing app), then sync to
// localStorage after mount. The actual token swap happens in globals.css via
// [data-theme="light"]. Dark mode is the default and is NOT changed by any of
// this code.
//
// Split from theme.ts so that file stays importable from Node server routes
// (which only need the design tokens, not React).

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { type Theme, THEME_STORAGE_KEY } from './theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always render 'dark' on the server + first client paint to avoid hydration
  // mismatches when localStorage holds 'light'. The effect applies the stored
  // theme (and the data-theme attribute) after mount.
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const stored = (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? 'dark';
    if (stored === 'light' || stored === 'dark') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThemeState(stored);
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, t);
      document.documentElement.setAttribute('data-theme', t);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
