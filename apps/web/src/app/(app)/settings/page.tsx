"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ResurfaceFrequency, SessionInfo } from "@booklet/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme, type Theme } from "@/lib/theme/theme-provider";
import { loadUserSettings, saveUserSettings } from "@/lib/mock/store";
import { loadReaderPrefs, saveReaderPrefs } from "@/lib/reader/device-prefs";
import type { ReaderSize } from "@/components/reader/reader-toolbar";
import { useAuth } from "@/lib/auth/auth-provider";
import { loadSessions, revokeOtherSessions, revokeSession } from "@/lib/data/sessions";
import { exportAsMarkdownZip, importUrls, parseImportCsv } from "@/lib/data/export-import";
import { loadHoardingPrefs, saveHoardingPrefs } from "@/lib/data/hoarding-prefs";
import { loadShowReadingStats, saveShowReadingStats } from "@/lib/data/stats-prefs";
import { formatRelativeDate, summarizeUserAgent } from "@/lib/format";
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

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { status, user, logout, updateSettings, resendVerificationEmail } = useAuth();
  const [frequency, setFrequency] = useState<ResurfaceFrequency>("DAILY");
  const [perDigest, setPerDigest] = useState(5);
  const [readerSize, setReaderSize] = useState<ReaderSize>("md");
  const [ttsRate, setTtsRate] = useState(1);
  const [hoardingEnabled, setHoardingEnabled] = useState(false);
  const [maxUnread, setMaxUnread] = useState(25);
  const [showStats, setShowStats] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);

  // Device-local, not account-synced -- see device-prefs.ts. Read after
  // mount, same reasoning as reader-view.tsx's own read of these.
  useEffect(() => {
    function syncFromDevicePrefs() {
      const prefs = loadReaderPrefs();
      setReaderSize(prefs.size);
      setTtsRate(prefs.ttsRate);
      const hoarding = loadHoardingPrefs();
      setHoardingEnabled(hoarding.enabled);
      setMaxUnread(hoarding.maxUnread);
      setShowStats(loadShowReadingStats());
    }
    syncFromDevicePrefs();
  }, []);

  function handleReaderSizeChange(size: ReaderSize) {
    setReaderSize(size);
    saveReaderPrefs({ size, ttsRate });
  }

  function handleTtsRateChange(rate: number) {
    setTtsRate(rate);
    saveReaderPrefs({ size: readerSize, ttsRate: rate });
  }

  function handleHoardingEnabledChange(enabled: boolean) {
    setHoardingEnabled(enabled);
    saveHoardingPrefs({ enabled, maxUnread });
  }

  function handleMaxUnreadChange(value: number) {
    const clamped = Math.max(1, Math.min(500, value || 1));
    setMaxUnread(clamped);
    saveHoardingPrefs({ enabled: hoardingEnabled, maxUnread: clamped });
  }

  function handleShowStatsChange(enabled: boolean) {
    setShowStats(enabled);
    saveShowReadingStats(enabled);
  }

  const importInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;

    const rows = parseImportCsv(await file.text());
    if (rows.length === 0) {
      setImportStatus("Couldn't find a URL column in that file.");
      return;
    }

    setImporting(true);
    setImportStatus(`Importing 0 / ${rows.length}…`);
    const result = await importUrls(rows, status === "authenticated", (done, total) =>
      setImportStatus(`Importing ${done} / ${total}…`),
    );
    setImporting(false);
    setImportStatus(
      `Imported ${result.imported}, skipped ${result.skipped} already-saved, ${result.failed} failed.`,
    );
  }

  async function handleExport() {
    setExporting(true);
    try {
      await exportAsMarkdownZip(status === "authenticated");
    } finally {
      setExporting(false);
    }
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

        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Default text size
          </h2>
          <p className="font-sans text-xs text-ink-faint">
            Applies to a newly-opened article; this device only, not synced across devices.
          </p>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Default text size">
            {SIZES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => handleReaderSizeChange(s.value)}
                className={cn(
                  "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                  readerSize === s.value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Read-aloud speed
          </h2>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Read-aloud speed">
            {TTS_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => handleTtsRateChange(rate)}
                className={cn(
                  "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                  ttsRate === rate ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                )}
              >
                {rate}×
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Prevent knowledge hoarding
          </h2>
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
                !hoardingEnabled ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              Off
            </button>
            <button
              type="button"
              onClick={() => handleHoardingEnabledChange(true)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                hoardingEnabled ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              On
            </button>
          </div>
          {hoardingEnabled && (
            <label className="mt-1 flex flex-col gap-1.5">
              <span className="font-sans text-sm font-medium text-ink">Unread limit</span>
              <Input
                type="number"
                min={1}
                max={500}
                value={maxUnread}
                onChange={(e) => handleMaxUnreadChange(Number(e.target.value))}
                className="max-w-[100px]"
              />
            </label>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Reading stats</h2>
          <p className="font-sans text-xs text-ink-faint">
            Streaks, time spent, and completion rate -- a visible payoff for the resurfacing loop. Off by default.
          </p>
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Reading stats">
            <button
              type="button"
              onClick={() => handleShowStatsChange(false)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                !showStats ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              Off
            </button>
            <button
              type="button"
              onClick={() => handleShowStatsChange(true)}
              className={cn(
                "flex-1 rounded-sm py-1.5 font-sans text-sm font-medium transition-colors",
                showStats ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              On
            </button>
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
        <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Import &amp; export
        </h2>
        <p className="mb-4 font-sans text-sm text-ink-muted">
          Import a CSV export from Pocket or Instapaper (each URL is saved and extracted for real, the same as
          saving one by hand). Export everything as Markdown -- one file per article with its highlights, ready to
          drop into an Obsidian vault or import into Notion.
        </p>
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleImportFile}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={importing}
            onClick={() => importInputRef.current?.click()}
          >
            Import from Pocket
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={importing}
            onClick={() => importInputRef.current?.click()}
          >
            Import from Instapaper
          </Button>
          <Button type="button" variant="secondary" disabled={exporting} onClick={handleExport}>
            {exporting ? "Exporting…" : "Export as Markdown"}
          </Button>
        </div>
        {importStatus && <p className="mt-3 font-sans text-sm text-ink-muted">{importStatus}</p>}
      </section>

      <section className="mt-10 border-t border-border pt-6">
        <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Account</h2>
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
        <section className="mt-10 border-t border-border pt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Signed-in devices
            </h2>
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
    </div>
  );
}
