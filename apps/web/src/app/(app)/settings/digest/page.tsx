"use client";

import { useEffect, useState } from "react";
import type { ResurfaceFrequency } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-provider";
import { loadUserSettings, saveUserSettings } from "@/lib/mock/store";
import { cn } from "@/lib/cn";

const FREQUENCIES: { value: ResurfaceFrequency; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
];

export default function DigestSettingsPage() {
  const { status, user, updateSettings } = useAuth();
  const [frequency, setFrequency] = useState<ResurfaceFrequency>("DAILY");
  const [perDigest, setPerDigest] = useState(5);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function syncSettings() {
      if (status === "authenticated" && user) {
        setFrequency(user.resurfaceFrequency);
        setPerDigest(user.highlightsPerDigest);
        return;
      }
      if (status === "anonymous") {
        const settings = loadUserSettings();
        setFrequency(settings.resurfaceFrequency);
        setPerDigest(settings.highlightsPerDigest);
      }
    }
    syncSettings();
  }, [status, user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (status === "authenticated") {
      await updateSettings({ resurfaceFrequency: frequency, highlightsPerDigest: perDigest });
    } else {
      saveUserSettings({ resurfaceFrequency: frequency, highlightsPerDigest: perDigest });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <h2 className="mb-6 font-serif text-lg font-semibold text-ink">Daily Review</h2>
      <form onSubmit={handleSave} className="flex flex-col gap-4">
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

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary">
            Save changes
          </Button>
          {saved && <span className="font-sans text-sm text-accent">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
