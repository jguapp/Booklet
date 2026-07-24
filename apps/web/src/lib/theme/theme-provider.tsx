"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "sepia";

const STORAGE_KEY = "booklet-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function currentDomTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" || attr === "sepia" ? attr : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // A blocking inline script (see layout.tsx) already set data-theme before
  // hydration, so read it back rather than guessing -- this avoids a
  // server/client mismatch without needing a "mounted" loading flash.
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof document !== "undefined" ? currentDomTheme() : "light",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function setTheme(next: Theme) {
    setThemeState(next);
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
