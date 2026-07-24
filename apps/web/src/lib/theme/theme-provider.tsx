"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "sepia";

const STORAGE_KEY = "booklet-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Must match what the server renders -- the server has no `document` at
  // all, so it always renders "light". Branching on `typeof document` here
  // doesn't fix that: on the client this runs during hydration, *after* the
  // blocking inline script (layout.tsx) has already changed data-theme, so
  // it would read back something the server couldn't possibly have rendered
  // and React would flag a hydration mismatch on every attribute that reads
  // `theme` (e.g. aria-pressed on the theme buttons).
  const [theme, setThemeState] = useState<Theme>("light");

  // Sync React's state from the DOM once, right after hydration. This is a
  // client-only correction (not a hydration mismatch): the *visual* theme
  // was already applied via the data-theme attribute before this ever runs,
  // so there's no color flash -- only React-rendered attributes that read
  // `theme` update, one frame after mount.
  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark" || attr === "sepia" || attr === "light") {
      setThemeState(attr);
    }
  }, []);

  function setTheme(next: Theme) {
    setThemeState(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private browsing, etc.) -- theme still
      // applies for this session via the DOM attribute above.
    }
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
