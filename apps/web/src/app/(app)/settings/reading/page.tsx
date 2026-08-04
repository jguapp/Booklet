"use client";

import { useTheme, type Theme } from "@/lib/theme/theme-provider";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import type { ReaderSize } from "@/components/reader/reader-toolbar";
import { PIPER_VOICES, NATIVE_VOICE_ID } from "@/lib/reader/piper-tts";
import { HighlightColorPicker } from "@/components/settings/highlight-color-picker";
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
  const { reader, setReaderSize, setTtsRate, setTtsVoice, setShowProgressBar, setPdfReadingMode } = useDevicePrefs();

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
                  theme === t.value ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
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
                  reader.size === s.value ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Progress bar
          </h3>
          <p className="font-sans text-xs text-ink-faint">
            A persistent bar at the bottom of the reader showing % complete and time left, visible no matter
            how far you&rsquo;ve scrolled or paginated -- this device only, not synced across devices.
          </p>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Progress bar">
            <button
              type="button"
              onClick={() => setShowProgressBar(false)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                !reader.showProgressBar ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              Off
            </button>
            <button
              type="button"
              onClick={() => setShowProgressBar(true)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                reader.showProgressBar ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              On
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            PDF reading mode
          </h3>
          <p className="font-sans text-xs text-ink-faint">
            Page-turn (one page at a time) or continuous scroll -- this device only, not synced across devices.
          </p>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="PDF reading mode">
            <button
              type="button"
              onClick={() => setPdfReadingMode("paginate")}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                reader.pdfReadingMode === "paginate" ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              Page-turn
            </button>
            <button
              type="button"
              onClick={() => setPdfReadingMode("scroll")}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                reader.pdfReadingMode === "scroll" ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              Continuous scroll
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Highlight colors
          </h3>
          <p className="font-sans text-xs text-ink-faint">
            Choose which colors show up in the picker when you highlight text, and add your own -- this
            device only, not synced across devices.
          </p>
          <HighlightColorPicker />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Read-aloud voice
          </h3>
          <p className="font-sans text-xs text-ink-faint">
            Piper voices are open-source and run entirely on this device (no account, no per-use cost) --
            the first play downloads that voice&rsquo;s model once (about 60MB), then it&rsquo;s cached for next time.
          </p>
          <select
            aria-label="Read-aloud voice"
            value={reader.ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value)}
            className="w-full max-w-xs rounded-sm border border-border bg-surface px-3 py-2 font-sans text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value={NATIVE_VOICE_ID}>System voice (this device&rsquo;s own, instant)</option>
            {PIPER_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
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
                  reader.ttsRate === rate ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
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
