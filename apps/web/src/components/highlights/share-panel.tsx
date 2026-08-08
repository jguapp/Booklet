"use client";

import { useEffect, useState } from "react";
import type { Share } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconCheck, IconLink } from "@/components/ui/icons";
import {
  createShare,
  loadContributionSettings,
  loadShares,
  revokeShare,
  setContributionSetting,
  shareUrl,
} from "@/lib/data/shares";
import { useToast } from "@/lib/toast/toast-provider";

interface SharePanelProps {
  articleId: string;
  /** Local mode has no server to serve a public page from -- see the module
   * comment in lib/data/shares.ts. The caller passes false there and this
   * renders the explanation instead of a dead button. */
  authenticated: boolean;
}

/**
 * Share / unshare for one article's highlights (#158 part 1), plus the
 * separate aggregation opt-in.
 *
 * The opt-in lives here rather than in Settings deliberately: it is a
 * question about sharing, and asking it next to the thing being shared is
 * the only place a person has enough context to answer it. Buried three
 * screens away in Settings it becomes a checkbox people tick without reading,
 * which is not consent in any sense worth having.
 */
export function SharePanel({ articleId, authenticated }: SharePanelProps) {
  const { toast } = useToast();
  const [share, setShare] = useState<Share | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [contributes, setContributes] = useState(false);

  useEffect(() => {
    // Nothing to fetch in local mode -- and no setState on this path either,
    // which keeps the effect free of the synchronous-setState cascade the
    // lint rule (rightly) rejects. The local-mode branch renders below
    // without waiting on `loaded` at all.
    if (!authenticated) return;
    let cancelled = false;
    Promise.all([loadShares(), loadContributionSettings()])
      .then(([shares, settings]) => {
        if (cancelled) return;
        setShare(shares.find((s) => s.articleId === articleId) ?? null);
        setContributes(settings.contributesToPublicHighlights);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [articleId, authenticated]);

  async function handleShare() {
    setBusy(true);
    try {
      setShare(await createShare({ articleId }));
    } catch {
      toast("Couldn't create the link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    if (!share) return;
    setConfirmingRevoke(false);
    setBusy(true);
    try {
      await revokeShare(share.id);
      setShare(null);
      toast("Link revoked. Anyone who had it now gets a dead page.");
    } catch {
      toast("Couldn't revoke the link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(shareUrl(share.slug));
      toast("Link copied.");
    } catch {
      // Clipboard access is blocked in some browsers/contexts (non-HTTPS,
      // permissions). The input below is readOnly rather than disabled
      // precisely so selecting and copying by hand still works when this
      // fails.
      toast("Copy failed — select the link and copy it manually.");
    }
  }

  async function handleToggleContribution(next: boolean) {
    setContributes(next);
    try {
      await setContributionSetting(next);
    } catch {
      setContributes(!next);
      toast("Couldn't save that preference.");
    }
  }

  if (!authenticated) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-3 font-sans text-xs text-ink-muted">
        Sharing a page needs an account — the link has to be served to someone else&rsquo;s browser, and right
        now these highlights only exist on this device.
      </p>
    );
  }

  if (!loaded) return null;

  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3">
      {share ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={shareUrl(share.slug)}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-sm border border-border bg-paper px-2.5 py-1.5 font-sans text-xs text-ink-muted outline-none"
            />
            <Button variant="secondary" onClick={handleCopy} className="px-3 py-1.5 text-xs">
              <IconLink className="h-3.5 w-3.5" />
              Copy
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmingRevoke(true)}
              className="px-3 py-1.5 text-xs"
            >
              Unshare
            </Button>
          </div>
          <p className="mt-2 font-sans text-xs text-ink-faint">
            Anyone with this link can read these highlights and the source links — nothing else about your
            account, and not the articles themselves.
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-sans text-xs text-ink-muted">
            Publish these highlights at an unlisted link you can send to anyone.
          </p>
          <Button variant="secondary" disabled={busy} onClick={handleShare} className="px-3 py-1.5 text-xs">
            <IconLink className="h-3.5 w-3.5" />
            Share
          </Button>
        </div>
      )}

      <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-border pt-3">
        <input
          type="checkbox"
          checked={contributes}
          onChange={(e) => handleToggleContribution(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="font-sans text-xs text-ink-muted">
          Count my published highlights toward what Booklet suggests to new readers.
          <span className="mt-0.5 flex items-center gap-1 text-ink-faint">
            <IconCheck className="h-3 w-3 shrink-0" />
            {/* Stating the threshold in the UI, not just in the code: "3
                readers highlighted this" is the only claim the aggregate can
                make, and someone deciding whether to opt in deserves to know
                that before they tick the box rather than after. */}
            Only passages at least 3 different readers highlighted, never your name or which ones were yours.
          </span>
        </span>
      </label>

      {confirmingRevoke && (
        <ConfirmDialog
          title="Unshare these highlights?"
          message="The link stops working immediately and can't be turned back on — sharing again creates a different link."
          confirmLabel="Unshare"
          onCancel={() => setConfirmingRevoke(false)}
          onConfirm={handleRevoke}
        />
      )}
    </div>
  );
}
