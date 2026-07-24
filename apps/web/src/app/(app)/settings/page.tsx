"use client";

import { useEffect, useState } from "react";
import type { ResurfaceFrequency } from "@booklet/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme, type Theme } from "@/lib/theme/theme-provider";
import { mockUser } from "@/lib/mock/data";
import { loadUserSettings, saveUserSettings } from "@/lib/mock/store";
import { cn } from "@/lib/cn";

const FREQUENCIES: { value: ResurfaceFrequency; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
];

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [frequency, setFrequency] = useState<ResurfaceFrequency>("DAILY");
  const [perDigest, setPerDigest] = useState(5);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const settings = loadUserSettings();
    setFrequency(settings.resurfaceFrequency);
    setPerDigest(settings.highlightsPerDigest);
  }, []);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    saveUserSettings({ resurfaceFrequency: frequency, highlightsPerDigest: perDigest });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mx-auto max-w-xl px-8 py-10">
      <h1 className="mb-8 font-serif text-2xl font-semibold text-ink">Settings</h1>

      <form onSubmit={handleSave} className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Daily Review</h2>

          <div>
            <label className="mb-1.5 block font-sans text-sm font-medium text-ink">Frequency</label>
            <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Digest frequency">
              {FREQUENCIES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFrequency(f.value)}
                  className={cn(
                    "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                    frequency === f.value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="font-sans text-sm font-medium text-ink">Highlights per digest</span>
            <Input
              type="number"
              min={1}
              max={20}
              value={perDigest}
              onChange={(e) => setPerDigest(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="max-w-[100px]"
            />
          </label>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Reading theme
          </h2>
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

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary">
            Save changes
          </Button>
          {saved && <span className="font-sans text-sm text-accent">Saved.</span>}
        </div>
      </form>

      <section className="mt-10 border-t border-border pt-6">
        <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Account</h2>
        <p className="mb-4 font-sans text-sm text-ink-muted">{mockUser.email}</p>
        <ButtonLink href="/login" variant="secondary">
          Log out
        </ButtonLink>
      </section>
    </div>
  );
}
