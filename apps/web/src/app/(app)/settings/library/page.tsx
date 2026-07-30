"use client";

import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const AUTO_DELETE_PERIODS = [
  { value: 7, label: "1 week" },
  { value: 30, label: "1 month" },
  { value: 90, label: "3 months" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
];

export default function LibrarySettingsPage() {
  const { hoarding, showReadingStats, autoDelete, setHoarding, setShowReadingStats, setAutoDelete } =
    useDevicePrefs();

  function handleHoardingEnabledChange(enabled: boolean) {
    setHoarding({ ...hoarding, enabled });
  }

  function handleMaxUnreadChange(value: number) {
    setHoarding({ ...hoarding, maxUnread: Math.max(1, Math.min(500, value || 1)) });
  }

  function handleAutoDeleteEnabledChange(enabled: boolean) {
    setAutoDelete({ ...autoDelete, enabled });
  }

  function handleAutoDeleteDaysChange(days: number) {
    setAutoDelete({ ...autoDelete, days });
  }

  return (
    <div>
      <h2 className="mb-6 font-serif text-lg font-semibold text-ink">Library</h2>
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Prevent knowledge hoarding
          </h3>
          <p className="font-sans text-xs text-ink-faint">
            Saving is frictionless and reading isn&apos;t -- it&apos;s easy to end up with an unread backlog too
            big to ever get through. When on, saving while at or above the limit below asks first instead of
            growing the pile silently.
          </p>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Prevent knowledge hoarding">
            <button
              type="button"
              onClick={() => handleHoardingEnabledChange(false)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                !hoarding.enabled ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              Off
            </button>
            <button
              type="button"
              onClick={() => handleHoardingEnabledChange(true)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                hoarding.enabled ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              On
            </button>
          </div>
          {hoarding.enabled && (
            <label className="mt-1 flex flex-col gap-1.5">
              <span className="font-sans text-sm font-medium text-ink">Unread limit</span>
              <Input
                type="number"
                min={1}
                max={500}
                value={hoarding.maxUnread}
                onChange={(e) => handleMaxUnreadChange(Number(e.target.value))}
                className="max-w-[100px]"
              />
            </label>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Auto-delete old unread articles
          </h3>
          <p className="font-sans text-xs text-ink-faint">
            Another way to keep the backlog from becoming overwhelming: an UNREAD article older than the period
            below moves to Trash on its own (still recoverable there for 30 days, same as deleting one by hand).
            Never touches anything you&rsquo;ve started reading or archived.
          </p>
          <div
            className="flex gap-1 rounded-sm bg-surface-2 p-1"
            role="group"
            aria-label="Auto-delete old unread articles"
          >
            <button
              type="button"
              onClick={() => handleAutoDeleteEnabledChange(false)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                !autoDelete.enabled ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              Off
            </button>
            <button
              type="button"
              onClick={() => handleAutoDeleteEnabledChange(true)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                autoDelete.enabled ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              On
            </button>
          </div>
          {autoDelete.enabled && (
            <div className="mt-1 flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Auto-delete after">
              {AUTO_DELETE_PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handleAutoDeleteDaysChange(p.value)}
                  className={cn(
                    "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                    autoDelete.days === p.value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Reading stats</h3>
          <p className="font-sans text-xs text-ink-faint">
            Streaks, time spent, and completion rate -- a visible payoff for the resurfacing loop. Off by default.
          </p>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Reading stats">
            <button
              type="button"
              onClick={() => setShowReadingStats(false)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                !showReadingStats ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              Off
            </button>
            <button
              type="button"
              onClick={() => setShowReadingStats(true)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                showReadingStats ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              On
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
