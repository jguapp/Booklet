"use client";

import { useTheme, type Theme } from "@/lib/theme/theme-provider";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import type { ReaderSize } from "@/components/reader/reader-toolbar";
import { cn } from "@/lib/cn";

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
  { value: "kindle", label: "Kindle" },
];

const SIZES: { value: ReaderSize; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "X-Large" },
];

const TTS_RATES = [0.75, 1, 1.25, 1.5, 2];

export default function ReadingSettingsPage() {
  const { theme, setTheme } = useTheme();
  const { reader, setReaderSize, setTtsRate } = useDevicePrefs();

  return (
    <div>
      <h2 className="mb-6 font-serif text-lg font-semibold text-ink">Reading</h2>
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Reading theme</h3>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value)}
                className={cn(
                  "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                  theme === t.value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Default text size
          </h3>
          <p className="font-sans text-xs text-ink-faint">
            Applies to a newly-opened article; this device only, not synced across devices.
          </p>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Default text size">
            {SIZES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setReaderSize(s.value)}
                className={cn(
                  "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                  reader.size === s.value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Read-aloud speed
          </h3>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Read-aloud speed">
            {TTS_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setTtsRate(rate)}
                className={cn(
                  "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                  reader.ttsRate === rate ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                )}
              >
                {rate}×
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
