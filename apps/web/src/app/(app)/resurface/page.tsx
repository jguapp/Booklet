"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, Highlight, ResurfaceCandidate, ResurfaceFeedback } from "@booklet/shared";
import { applySm2Review, feedbackToQuality, selectHighlightsToResurface } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { HighlightListItem } from "@/components/highlights/highlight-list-item";
import { loadArticles } from "@/lib/data/articles";
import { updateHighlightFeedback } from "@/lib/data/highlights";
import { emailDigest, loadCurrentDigest } from "@/lib/data/digests";
import { loadHighlights as loadLocalHighlights } from "@/lib/data/highlights";
import { loadUserSettings } from "@/lib/mock/store";
import { useAuth } from "@/lib/auth/auth-provider";
import { useToast } from "@/lib/toast/toast-provider";

export default function ResurfacePage() {
  const { status, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [articles, setArticles] = useState<Article[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [batchIds, setBatchIds] = useState<string[] | null>(null);
  const [digestId, setDigestId] = useState<string | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (status === "loading") return;
    loadArticles(isAuthenticated).then(async (loadedArticles) => {
      setArticles(loadedArticles);

      if (isAuthenticated) {
        // Server picks and persists the batch (see GET /api/digests/current),
        // so a reload -- or a second device -- sees the same highlights
        // instead of a freshly re-rolled random selection.
        const digest = await loadCurrentDigest();
        const batchHighlights = digest.highlights ?? [];
        setHighlights(batchHighlights);
        setBatchIds(batchHighlights.map((h) => h.id));
        setDigestId(digest.id);
        return;
      }

      // loadArticles() already excludes trash -- a trashed article's
      // highlights shouldn't keep resurfacing (a stronger "I'm done with
      // this" signal than archiving, whose highlights stay eligible on
      // purpose), so filter against the article IDs that survived that.
      const nonTrashedArticleIds = new Set(loadedArticles.map((a) => a.id));
      const loadedHighlights = (await loadLocalHighlights(false)).filter((h) =>
        nonTrashedArticleIds.has(h.articleId),
      );
      setHighlights(loadedHighlights);
      const highlightsPerDigest = loadUserSettings().highlightsPerDigest;
      const candidates: ResurfaceCandidate[] = loadedHighlights.map((h) => ({
        id: h.id,
        nextDueAt: h.nextDueAt,
        resurfaceArchivedAt: h.resurfaceArchivedAt,
      }));
      const selected = selectHighlightsToResurface(candidates, highlightsPerDigest);
      setBatchIds(selected.map((c) => c.id));
    });
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const batch = useMemo(() => {
    if (!batchIds) return [];
    const ids = new Set(batchIds);
    return highlights.filter((h) => ids.has(h.id) && !reviewedIds.has(h.id));
  }, [highlights, batchIds, reviewedIds]);

  async function applyFeedback(highlightId: string, feedback: ResurfaceFeedback | null, archive: boolean) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const now = new Date();
    const nowIso = now.toISOString();

    // SM-2 scheduling only makes sense on an actual recall judgment --
    // archiving without feedback just removes it from rotation outright.
    const sm2 = feedback
      ? applySm2Review(
          { easinessFactor: target.easinessFactor, intervalDays: target.intervalDays, repetitions: target.repetitions },
          feedbackToQuality(feedback),
          now,
        )
      : null;

    const updated = await updateHighlightFeedback(
      target,
      {
        lastSurfacedAt: nowIso,
        surfaceCount: target.surfaceCount + 1,
        ...(feedback ? { lastFeedback: feedback, lastFeedbackAt: nowIso } : {}),
        ...(archive ? { resurfaceArchivedAt: nowIso } : {}),
        ...(sm2
          ? {
              easinessFactor: sm2.easinessFactor,
              intervalDays: sm2.intervalDays,
              repetitions: sm2.repetitions,
              nextDueAt: sm2.nextDueAt,
            }
          : {}),
      },
      isAuthenticated,
    );
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
    setReviewedIds((prev) => new Set(prev).add(highlightId));

    // The card just disappeared from the batch -- say where it went instead
    // of leaving that unexplained. sm2.intervalDays is the real computed
    // interval (SM-2 always resets a "forgot" to exactly 1 day), not a guess.
    if (feedback === "REMEMBERED" && sm2) {
      toast(`Nice — you'll see this again in ${sm2.intervalDays} day${sm2.intervalDays === 1 ? "" : "s"}.`);
    } else if (feedback === "FORGOT" && sm2) {
      toast("No worries — you'll see this again tomorrow.");
    } else if (archive) {
      toast("Archived — it won't resurface again.");
    }
  }

  async function handleEmailDigest() {
    if (!digestId) return;
    setEmailStatus("Sending…");
    try {
      await emailDigest(digestId);
      setEmailStatus("Sent to your email.");
    } catch {
      setEmailStatus("Couldn't send that email. Try again in a moment.");
    }
  }

  const isDone = batchIds !== null && batch.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold text-ink">Daily Review</h1>
        {isAuthenticated && digestId && batchIds && batchIds.length > 0 && (
          <Button variant="secondary" onClick={handleEmailDigest}>
            Email me this digest
          </Button>
        )}
      </div>
      <p className="mb-8 font-sans text-sm text-ink-muted">
        {batchIds ? `${batchIds.length} highlight${batchIds.length === 1 ? "" : "s"} selected for today.` : ""}
      </p>

      {emailStatus && (
        <p className="mb-6 rounded-sm bg-surface-2 px-3 py-2 font-sans text-xs text-ink-muted">{emailStatus}</p>
      )}

      {batchIds && batchIds.length === 0 && (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">
            No highlights are eligible to resurface right now — check back once you&apos;ve saved a few.
          </p>
        </div>
      )}

      {isDone && batchIds!.length > 0 && (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">That&apos;s everything for today. Nicely done.</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {batch.map((h) => (
          <HighlightListItem
            key={h.id}
            highlight={h}
            article={articleById.get(h.articleId)}
            actions={
              <>
                <Button variant="secondary" onClick={() => applyFeedback(h.id, "FORGOT", false)}>
                  Forgot this
                </Button>
                <Button variant="secondary" onClick={() => applyFeedback(h.id, null, true)}>
                  Archive
                </Button>
                <Button variant="primary" onClick={() => applyFeedback(h.id, "REMEMBERED", false)}>
                  Remembered this
                </Button>
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}
