"use client";

import { formatMinutesLeft } from "@/lib/format";

interface ReaderProgressBarProps {
  progress: number; // 0-1
  remainingMinutes: number | null;
}

/** A persistent, Kindle-style bottom bar -- % complete and time left,
 * visible regardless of how far you've scrolled or paginated (unlike the
 * "N min left" text in the byline up top, which scrolls away immediately).
 * Optional -- see Settings > Reading's toggle, device-prefs.ts's
 * showProgressBar. */
export function ReaderProgressBar({ progress, remainingMinutes }: ReaderProgressBarProps) {
  const percent = Math.round(progress * 100);
  return (
    <div data-reader-progress-bar className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[680px] items-center justify-between px-6 py-1.5 font-sans text-xs text-ink-muted">
        <span>{percent}%</span>
        {remainingMinutes !== null && <span>{formatMinutesLeft(remainingMinutes)}</span>}
      </div>
      <div className="h-0.5 w-full bg-border">
        <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
