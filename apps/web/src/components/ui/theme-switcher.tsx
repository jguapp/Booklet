"use client";

import { useTheme, type Theme } from "@/lib/theme/theme-provider";
import { cn } from "@/lib/cn";

// Same swatch colors as reader-toolbar.tsx's theme control -- duplicated
// rather than shared since that one is wired to a controlled theme/
// onThemeChange pair passed down from reader-view.tsx, while this is a
// self-contained control (reads useTheme() directly) meant to be dropped in
// anywhere in the app shell, not just the reader.
const THEME_SWATCH_CLASS: Record<Theme, string> = {
  light: "bg-[#EDEBE2] text-[#211F1A]",
  sepia: "bg-[#E7D8B2] text-[#392E1C]",
  dark: "bg-[#14181A] text-[#E8E4DA]",
};

export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn("flex items-center gap-1.5", className)} role="group" aria-label="Theme">
      {(["light", "sepia", "dark"] as Theme[]).map((t) => (
        <button
          key={t}
          type="button"
          title={t.charAt(0).toUpperCase() + t.slice(1)}
          aria-pressed={theme === t}
          onClick={() => setTheme(t)}
          className={cn(
            "h-6 w-6 rounded-full border-[1.5px] text-[10px] font-bold transition-colors",
            THEME_SWATCH_CLASS[t],
            theme === t ? "border-accent ring-2 ring-accent/40" : "border-border",
          )}
        >
          Aa
        </button>
      ))}
    </div>
  );
}
