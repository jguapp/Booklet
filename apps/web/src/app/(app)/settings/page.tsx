"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionInfo } from "@booklet/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-provider";
import { loadSessions, revokeOtherSessions, revokeSession } from "@/lib/data/sessions";
import { formatRelativeDate, summarizeUserAgent } from "@/lib/format";

export default function AccountSettingsPage() {
  const router = useRouter();
  const { status, user, logout, updateSettings, resendVerificationEmail } = useAuth();
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [kindleEmail, setKindleEmailInput] = useState("");
  const [kindleSaved, setKindleSaved] = useState(false);
  const [savingKindleEmail, setSavingKindleEmail] = useState(false);

  useEffect(() => {
    function syncKindleEmail() {
      if (status === "authenticated" && user) setKindleEmailInput(user.kindleEmail ?? "");
    }
    syncKindleEmail();
  }, [status, user]);

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

  async function handleSaveKindleEmail(e: React.FormEvent) {
    e.preventDefault();
    setSavingKindleEmail(true);
    try {
      await updateSettings({ kindleEmail });
      setKindleSaved(true);
      setTimeout(() => setKindleSaved(false), 2000);
    } finally {
      setSavingKindleEmail(false);
    }
  }

  return (
    <div>
      <h2 className="mb-6 font-serif text-lg font-semibold text-ink">Account</h2>

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

            <form onSubmit={handleSaveKindleEmail} className="mt-8 flex flex-col gap-1.5 border-t border-border pt-8">
              <label className="font-sans text-sm font-medium text-ink" htmlFor="kindle-email">
                Kindle email
              </label>
              <p className="mb-1 font-sans text-xs text-ink-faint">
                Your @kindle.com address, from Amazon&rsquo;s Manage Your Content and Devices → Preferences →
                Personal Document Settings. You&rsquo;ll also need to add Booklet&rsquo;s sending address as an
                approved sender there, or Amazon will reject the email. Once set, every article gets a &ldquo;Send
                to Kindle&rdquo; button in the reader.
              </p>
              <div className="flex items-center gap-3">
                <Input
                  id="kindle-email"
                  type="email"
                  placeholder="you_abc123@kindle.com"
                  value={kindleEmail}
                  onChange={(e) => setKindleEmailInput(e.target.value)}
                  className="max-w-xs"
                />
                <Button type="submit" variant="secondary" disabled={savingKindleEmail}>
                  {savingKindleEmail ? "Saving…" : "Save"}
                </Button>
                {kindleSaved && <span className="font-sans text-sm text-accent">Saved.</span>}
              </div>
            </form>
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
        <section className="mt-8 border-t border-border pt-8">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Signed-in devices
            </h3>
            {sessions.length > 1 && (
              <button type="button" onClick={handleRevokeOthers} className="font-sans text-xs font-medium text-accent">
                Log out other devices
              </button>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2.5">
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
