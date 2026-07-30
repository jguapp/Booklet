"use client";

import Link from "next/link";
import type { Theme } from "@/lib/theme/theme-provider";
import { IconSidebar } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export type ReaderSize = "sm" | "md" | "lg" | "xl";
const SIZES: ReaderSize[] = ["sm", "md", "lg", "xl"];

const THEME_SWATCH_CLASS: Record<Theme, string> = {
  light: "bg-[#EDEBE2] text-[#211F1A]",
  sepia: "bg-[#E7D8B2] text-[#392E1C]",
  dark: "bg-[#14181A] text-[#E8E4DA]",
  kindle: "bg-white text-black",
};

interface ReaderToolbarProps {
  siteName: string | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  size: ReaderSize;
  onSizeChange: (size: ReaderSize) => void;
  progress: number;
  showNotebook: boolean;
  onToggleNotebook: () => void;
}

export function ReaderToolbar({
  siteName,
  theme,
  onThemeChange,
  size,
  onSizeChange,
  progress,
  showNotebook,
  onToggleNotebook,
}: ReaderToolbarProps) {
  const sizeIndex = SIZES.indexOf(size);

  return (
    <div className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[680px] items-center justify-between gap-4 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3 font-sans text-ink-muted">
          <Link
            href="/library"
            title="Back to library"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <span className="flex min-w-0 items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            {/* A real source label, not incidental chrome -- and for an
                uploaded PDF/EPUB with no site metadata, this can be a long
                original filename, so it truncates instead of wrapping/
                overflowing, with the full name still available on hover. */}
            <span className="truncate text-sm font-medium text-ink" title={siteName ?? "Reader"}>
              {siteName ?? "Reader"}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2" role="group" aria-label="Reading theme">
          {(["light", "sepia", "dark", "kindle"] as Theme[]).map((t) => (
            <button
              key={t}
              type="button"
              title={t.charAt(0).toUpperCase() + t.slice(1)}
              aria-pressed={theme === t}
              onClick={() => onThemeChange(t)}
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

        <div className="flex items-center gap-3 font-sans">
          <button
            type="button"
            title="Smaller text"
            disabled={sizeIndex === 0}
            onClick={() => onSizeChange(SIZES[Math.max(0, sizeIndex - 1)])}
            className="text-sm text-ink-muted transition-colors hover:text-accent disabled:opacity-30"
          >
            A
          </button>
          <div className="flex gap-1">
            {SIZES.map((s) => (
              <span
                key={s}
                className={cn("h-1 w-1 rounded-full", s === size ? "bg-accent" : "bg-border")}
              />
            ))}
          </div>
          <button
            type="button"
            title="Larger text"
            disabled={sizeIndex === SIZES.length - 1}
            onClick={() => onSizeChange(SIZES[Math.min(SIZES.length - 1, sizeIndex + 1)])}
            className="text-lg text-ink-muted transition-colors hover:text-accent disabled:opacity-30"
          >
            A
          </button>
          <button
            type="button"
            title={showNotebook ? "Hide Notebook" : "Show Notebook"}
            aria-pressed={showNotebook}
            onClick={onToggleNotebook}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full transition-colors",
              showNotebook ? "bg-surface-2 text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            <IconSidebar className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="h-0.5 w-full bg-border">
        <div
          className="h-full bg-accent transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
