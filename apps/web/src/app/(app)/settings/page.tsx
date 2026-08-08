"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PodcastFeedStatus, SessionInfo, UserProfile } from "@booklet/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useAuth } from "@/lib/auth/auth-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { loadSessions, revokeOtherSessions, revokeSession } from "@/lib/data/sessions";
import { createPodcastFeed, loadPodcastFeedStatus, revokePodcastFeed } from "@/lib/data/podcast";
import { deleteAccount } from "@/lib/data/account";
import { ApiError } from "@/lib/api/client";
import { formatRelativeDate, summarizeUserAgent } from "@/lib/format";

/**
 * The only place a podcast feed URL is ever obtainable (#154).
 *
 * Two things this section has to get across, both of which are consequences
 * of the URL being the entire credential -- a podcast client cannot send a
 * header, a cookie or an OAuth token, so the secret has to live in the URL:
 *
 * - Anyone holding it can read and listen to the whole library. It gets the
 *   same treatment as the generated-token box on the developer page, plus an
 *   explicit warning, because a URL does not *look* like a password and gets
 *   pasted into group chats in a way a "blk_..." string does not.
 * - It is shown exactly once. The server keeps only a hash, so there is no
 *   "show it again" -- losing it means regenerating, which invalidates the
 *   old one and requires resubscribing.
 */
function PodcastFeedSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<PodcastFeedStatus | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    loadPodcastFeedStatus().then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleGenerate() {
    setBusy(true);
    try {
      const feed = await createPodcastFeed();
      setRevealed(feed.url);
      setStatus(feed);
    } catch {
      toast("Couldn't create a feed URL.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    try {
      await revokePodcastFeed();
      setRevealed(null);
      refresh();
    } catch {
      toast("Couldn't turn the feed off.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast("Feed URL copied.");
    } catch {
      // Clipboard access is denied outright in some browsers/contexts, and
      // the URL is visible on screen anyway -- selecting it by hand is a
      // complete fallback, so this is not worth an error.
      toast("Copy the URL from the box above.");
    }
  }

  return (
    <section className="mt-8 border-t border-border pt-8">
      <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Podcast feed</h3>
      <p className="mt-2 font-sans text-sm text-ink-muted">
        Subscribe to your unread queue in any podcast app and listen with lock-screen controls, CarPlay and offline
        sync. Audio is generated in the background, so episodes appear over the first few refreshes rather than all
        at once.
      </p>
      <p className="mt-2 font-sans text-xs text-ink-faint">
        Podcast apps can&rsquo;t report playback position back, so listening here won&rsquo;t mark anything as read
        in Booklet.
      </p>

      {revealed && (
        <div className="mt-4 rounded-md border border-accent/30 bg-accent/10 px-4 py-3">
          <p className="font-sans text-xs font-medium text-ink">
            Treat this URL like a password &mdash; anyone who has it can read and listen to everything you&rsquo;ve
            saved. Copy it now; it won&rsquo;t be shown again.
          </p>
          <code
            data-testid="podcast-feed-url"
            className="mt-2 block overflow-x-auto rounded-sm bg-surface px-3 py-2 font-mono text-xs text-ink"
          >
            {revealed}
          </code>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => handleCopy(revealed)}
              className="font-sans text-xs font-medium text-accent"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setRevealed(null)}
              className="font-sans text-xs font-medium text-ink-muted"
            >
              Done
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={handleGenerate} disabled={busy}>
          {status?.enabled ? "Regenerate feed URL" : "Generate feed URL"}
        </Button>
        {status?.enabled && (
          <button
            type="button"
            onClick={handleRevoke}
            disabled={busy}
            className="font-sans text-xs font-medium text-ink-muted hover:text-red-500 disabled:opacity-50"
          >
            Turn off
          </button>
        )}
      </div>

      {status?.enabled && (
        <p className="mt-2 font-sans text-xs text-ink-faint">
          Active since {formatRelativeDate(status.createdAt!)} ·{" "}
          {status.lastFetchedAt ? `last fetched ${formatRelativeDate(status.lastFetchedAt)}` : "not fetched yet"}.
          Regenerating invalidates the old URL, so you&rsquo;d need to resubscribe.
        </p>
      )}
    </section>
  );
}

/**
 * Deleting the account (#174).
 *
 * Collapsed behind a link rather than sitting open, and the confirmation is
 * the same one the server will check -- password re-entry, or, for an
 * account created through OAuth that never set a password, typing the
 * account's own email address. The client could not skip that step even if
 * it wanted to (the route refuses without it); showing the right field is
 * only so the confirmation is possible at all for OAuth accounts, which have
 * no password to re-enter.
 *
 * What the copy has to say, because none of it is reversible and none of it
 * is obvious: it happens now rather than after a grace period, the export in
 * Settings → Import/Export is the only way to keep a copy, and shared links
 * stop working for whoever already has them.
 */
function DeleteAccountSection({ user, onDeleted }: { user: UserProfile; onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDeleting(true);
    try {
      await deleteAccount(user.hasPassword ? { password: confirmation } : { confirmEmail: confirmation });
      await onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete the account. Try again.");
      setDeleting(false);
    }
  }

  return (
    <section className="mt-8 border-t border-border pt-8">
      <h3 className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Delete account</h3>
      <p className="mt-2 font-sans text-sm text-ink-muted">
        Permanently deletes your account and everything in it: saved articles and uploaded files, highlights and
        notes, collections, tags, reading history, RSS subscriptions, API tokens, webhooks and generated audio. Any
        pages you&rsquo;ve shared stop working for everyone who has the link.
      </p>
      <p className="mt-2 font-sans text-xs text-ink-faint">
        This happens immediately — there is no waiting period and no way to undo it. If you want a copy first, use{" "}
        <Link href="/settings/import-export" className="font-medium text-accent">
          Export
        </Link>{" "}
        before you delete. The{" "}
        <Link href="/privacy" className="font-medium text-accent">
          privacy policy
        </Link>{" "}
        lists what is stored.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 font-sans text-sm font-medium text-red-500 hover:underline"
        >
          Delete my account
        </button>
      ) : (
        <form onSubmit={handleDelete} className="mt-4 flex max-w-sm flex-col gap-2">
          <label htmlFor="delete-confirmation" className="font-sans text-xs font-medium text-ink-muted">
            {user.hasPassword
              ? "Enter your password to confirm"
              : `Type ${user.email} to confirm`}
          </label>
          {user.hasPassword ? (
            <PasswordInput
              id="delete-confirmation"
              name="delete-confirmation"
              required
              autoFocus
              placeholder="••••••••"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          ) : (
            // No password on this account, so there is nothing to verify
            // against -- typing the address is the deliberate act that
            // stands in for it.
            <Input
              id="delete-confirmation"
              type="email"
              required
              autoFocus
              autoComplete="off"
              placeholder={user.email}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          )}

          {error && <p className="font-sans text-sm text-red-500">{error}</p>}

          <div className="mt-2 flex items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              disabled={deleting || confirmation.length === 0}
              className="bg-red-500 hover:bg-red-600"
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmation("");
                setError(null);
              }}
              disabled={deleting}
              className="font-sans text-sm font-medium text-ink-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

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

      {status === "authenticated" && <PodcastFeedSection />}

      {status === "authenticated" && user && (
        <DeleteAccountSection
          user={user}
          onDeleted={async () => {
            // logout() clears the in-memory token and provider state. The
            // server-side session rows are already gone with the account, so
            // the POST it makes is a no-op -- this is here for the client
            // half, which would otherwise keep rendering a signed-in shell
            // for an account that no longer exists.
            await logout();
            router.push("/");
          }}
        />
      )}

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
