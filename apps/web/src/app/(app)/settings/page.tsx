"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ResurfaceFrequency, SessionInfo } from "@booklet/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme, type Theme } from "@/lib/theme/theme-provider";
import { loadUserSettings, saveUserSettings } from "@/lib/mock/store";
import type { ReaderSize } from "@/components/reader/reader-toolbar";
import { useAuth } from "@/lib/auth/auth-provider";
import { loadSessions, revokeOtherSessions, revokeSession } from "@/lib/data/sessions";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { formatRelativeDate, summarizeUserAgent } from "@/lib/format";
import { IconCode, IconUpload } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const FREQUENCIES: { value: ResurfaceFrequency; label: string }[] = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
];

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

const AUTO_DELETE_PERIODS = [
  { value: 7, label: "1 week" },
  { value: 30, label: "1 month" },
  { value: 90, label: "3 months" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
];

/** Bigger, bolder than the per-section labels below it -- these are the
 * page's actual visual chunking, so "a long list of things" reads as a
 * handful of named groups instead. */
function CategoryHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-4 font-serif text-base font-semibold text-ink">{children}</h2>;
}

function Category({ children }: { children: React.ReactNode }) {
  return <div className="mt-10 border-t border-border pt-8 first:mt-0 first:border-t-0 first:pt-0">{children}</div>;
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { status, user, logout, updateSettings, resendVerificationEmail } = useAuth();
  const {
    reader,
    hoarding,
    showReadingStats,
    autoDelete,
    setReaderSize,
    setTtsRate,
    setHoarding,
    setShowReadingStats,
    setAutoDelete,
  } = useDevicePrefs();
  const [frequency, setFrequency] = useState<ResurfaceFrequency>("DAILY");
  const [perDigest, setPerDigest] = useState(5);
  const [saved, setSaved] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);

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

  const refreshSessions = useCallback(() => {
    if (status !== "authenticated") return;
    loadSessions().then(setSessions);
  }, [status]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  async function handleRevokeSession(id: string) {
    await revokeSession(id);
    setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
  }

  async function handleRevokeOthers() {
    await revokeOtherSessions();
    refreshSessions();
  }

  async function handleResendVerification() {
    setResendStatus("sending");
    try {
      await resendVerificationEmail();
      setResendStatus("sent");
    } catch {
      setResendStatus("idle");
    }
  }

  return (
    <div className="mx-auto max-w-xl px-8 py-10">
      <h1 className="mb-8 font-serif text-2xl font-semibold text-ink">Settings</h1>

      <Category>
        <CategoryHeader>Reading</CategoryHeader>
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
      </Category>

      <Category>
        <CategoryHeader>Library management</CategoryHeader>
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
            <div
              className="flex gap-1 rounded-sm bg-surface-2 p-1"
              role="group"
              aria-label="Prevent knowledge hoarding"
            >
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
              <div
                className="mt-1 flex gap-1 rounded-sm bg-surface-2 p-1"
                role="group"
                aria-label="Auto-delete after"
              >
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
      </Category>

      <Category>
        <CategoryHeader>Daily Review</CategoryHeader>
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
      </Category>

      <Category>
        <CategoryHeader>Data</CategoryHeader>
        <Link
          href="/import-export"
          className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3.5 transition-colors hover:border-accent/40"
        >
          <IconUpload className="h-5 w-5 shrink-0 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <p className="font-sans text-sm font-medium text-ink">Import &amp; export</p>
            <p className="font-sans text-xs text-ink-faint">
              Bring in Pocket/Instapaper, export to Markdown for Obsidian or Notion.
            </p>
          </div>
        </Link>
        <Link
          href="/developer"
          className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3.5 transition-colors hover:border-accent/40"
        >
          <IconCode className="h-5 w-5 shrink-0 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <p className="font-sans text-sm font-medium text-ink">Developer</p>
            <p className="font-sans text-xs text-ink-faint">
              Personal access tokens for the API, and webhooks for automations.
            </p>
          </div>
        </Link>
      </Category>

      <Category>
        <CategoryHeader>Account</CategoryHeader>
        <section>
          {status === "authenticated" && user ? (
            <>
              <p className="mb-4 font-sans text-sm text-ink-muted">
                Signed in as {user.email}. Your saves and highlights sync across devices.
              </p>
              {!user.emailVerified && (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-sm border border-accent/30 bg-accent/10 px-3 py-2.5">
                  <p className="font-sans text-sm text-ink">Your email is not verified yet.</p>
                  {resendStatus === "sent" ? (
                    <span className="font-sans text-xs text-ink-muted">Verification email sent.</span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={resendStatus === "sending"}
                      className="font-sans text-xs font-medium text-accent disabled:opacity-50"
                    >
                      {resendStatus === "sending" ? "Sending…" : "Resend verification email"}
                    </button>
                  )}
                </div>
              )}
              <Button type="button" variant="secondary" onClick={handleLogout}>
                Log out
              </Button>
            </>
          ) : (
            <>
              <p className="mb-4 font-sans text-sm text-ink-muted">
                Not signed in — everything is saved locally on this device only.
              </p>
              <ButtonLink href="/signup" variant="secondary">
                Create an account to sync
              </ButtonLink>
            </>
          )}
        </section>

        {status === "authenticated" && sessions && sessions.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Signed-in devices
              </h3>
              {sessions.length > 1 && (
                <button
                  type="button"
                  onClick={handleRevokeOthers}
                  className="font-sans text-xs font-medium text-accent"
                >
                  Log out other devices
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-sans text-sm text-ink">
                      {summarizeUserAgent(s.userAgent)}
                      {s.current && <span className="ml-2 font-sans text-xs text-accent">This device</span>}
                    </p>
                    <p className="font-sans text-xs text-ink-faint">
                      {s.ipAddress ?? "Unknown IP"} · signed in {formatRelativeDate(s.createdAt)}
                    </p>
                  </div>
                  {!s.current && (
                    <button
                      type="button"
                      onClick={() => handleRevokeSession(s.id)}
                      className="shrink-0 font-sans text-xs font-medium text-ink-muted hover:text-red-500"
                    >
                      Log out
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </Category>
    </div>
  );
}
