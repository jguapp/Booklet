"use client";

import { useState } from "react";
import { IconMinus, IconPlus } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  "aria-label"?: string;
}

/**
 * A bounded numeric picker styled like the app's other pill/segmented
 * controls (rounded bg-surface-2 pill, same as the Off/On and frequency
 * groups) instead of a bare `<input type="number">`, whose native spinner
 * arrows read as a different, clunkier control language than the rest of
 * settings.
 */
export function Stepper({ value, onChange, min, max, step = 1, className, ...rest }: StepperProps) {
  // Non-null only while the field is focused/being typed into -- lets it
  // show the live `value` prop the rest of the time with no effect needed
  // to keep the two in sync.
  const [editing, setEditing] = useState<string | null>(null);

  function commit(raw: string) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      onChange(Math.max(min, Math.min(max, Math.round(parsed))));
    }
    setEditing(null);
  }

  return (
    <div className={cn("inline-flex items-center gap-1 rounded-sm bg-surface-2 p-1", className)}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        aria-label="Decrease"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <IconMinus className="h-4 w-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={editing ?? String(value)}
        onFocus={() => setEditing(String(value))}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
        aria-label={rest["aria-label"]}
        className="w-12 shrink-0 rounded-sm bg-transparent text-center font-sans text-sm font-medium text-ink outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + step))}
        disabled={value >= max}
        aria-label="Increase"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <IconPlus className="h-4 w-4" />
      </button>
    </div>
  );
}
