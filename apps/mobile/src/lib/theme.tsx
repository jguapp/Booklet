/**
 * The mobile counterpart of the web app's theme system -- the same four
 * themes (Paper, Lamp, Night, Kindle) with the same palette hexes as
 * apps/web/src/app/globals.css, so an article looks like the same product
 * on both clients. The web keys its palettes off a data-theme attribute
 * and CSS variables; React Native has neither, so here each theme is a
 * concrete palette object handed out through context, and screens build
 * their StyleSheet from it.
 *
 * "system" is the stored default rather than "light", matching what the
 * web does when nothing is stored: its prefers-color-scheme media block
 * picks Night on a dark device. useColorScheme() is RN's equivalent.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "booklet_theme";

export type Theme = "light" | "dark" | "sepia" | "kindle";
export type ThemeChoice = Theme | "system";

export interface ThemePalette {
  paper: string;
  surface: string;
  surface2: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  border: string;
  accent: string;
  accentStrong: string;
  accentContrast: string;
  /** Accent-tinted fill for active chips -- the RN stand-in for the web's
   * translucent bg-accent/10, which RN can't express over a variable
   * background without real alpha compositing everywhere. */
  accentSoft: string;
  /** Errors/destructive actions. The web uses red-500 and, on Kindle, lets
   * its blanket grayscale(1) filter neutralize it; RN has no such filter,
   * so Kindle picks its gray by hand. */
  danger: string;
}

// Hex values match globals.css exactly (Paper/Night/Lamp/Kindle blocks);
// accentSoft and danger are the two RN-only additions described above.
export const THEMES: Record<Theme, ThemePalette> = {
  light: {
    paper: "#EDEBE2",
    surface: "#FAF9F4",
    surface2: "#F3F1E9",
    ink: "#211F1A",
    inkMuted: "#5C584D",
    inkFaint: "#86816F",
    border: "#DBD6C8",
    accent: "#1F6F6B",
    accentStrong: "#14514E",
    accentContrast: "#FBFAF6",
    accentSoft: "#DFEAE7",
    danger: "#DC2626",
  },
  dark: {
    paper: "#14181A",
    surface: "#1C2124",
    surface2: "#20272A",
    ink: "#E8E4DA",
    inkMuted: "#A6A093",
    inkFaint: "#767065",
    border: "#2D3336",
    accent: "#55C4B8",
    accentStrong: "#7ED8CD",
    accentContrast: "#0B1413",
    accentSoft: "#1D3532",
    danger: "#F87171",
  },
  sepia: {
    paper: "#E7D8B2",
    surface: "#DDCB9C",
    surface2: "#D6C08C",
    ink: "#392E1C",
    inkMuted: "#6B5A3C",
    inkFaint: "#8A7752",
    border: "#C9B481",
    accent: "#0F5A54",
    accentStrong: "#0B4A45",
    accentContrast: "#F5EFDC",
    accentSoft: "#C8CDA8",
    danger: "#B91C1C",
  },
  kindle: {
    paper: "#FFFFFF",
    surface: "#F7F7F7",
    surface2: "#ECECEC",
    ink: "#000000",
    inkMuted: "#4D4D4D",
    inkFaint: "#808080",
    border: "#CCCCCC",
    accent: "#000000",
    accentStrong: "#000000",
    accentContrast: "#FFFFFF",
    accentSoft: "#E0E0E0",
    danger: "#4D4D4D",
  },
};

/** Same display names the web's CSS comments use for these palettes. */
export const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Paper" },
  { value: "sepia", label: "Lamp" },
  { value: "dark", label: "Night" },
  { value: "kindle", label: "Kindle" },
];

interface ThemeContextValue {
  /** What's stored -- may be "system". */
  choice: ThemeChoice;
  /** What's rendered -- "system" resolved against the OS setting. */
  theme: Theme;
  palette: ThemePalette;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const systemScheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (stored === "light" || stored === "dark" || stored === "sepia" || stored === "kindle" || stored === "system") {
          setChoiceState(stored);
        }
      })
      .catch(() => undefined); // stays "system", which is the default anyway
    return () => {
      cancelled = true;
    };
  }, []);

  function setChoice(next: ThemeChoice) {
    setChoiceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }

  const theme: Theme = choice === "system" ? (systemScheme === "dark" ? "dark" : "light") : choice;
  const value = useMemo<ThemeContextValue>(
    () => ({ choice, theme, palette: THEMES[theme], setChoice }),
    [choice, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
