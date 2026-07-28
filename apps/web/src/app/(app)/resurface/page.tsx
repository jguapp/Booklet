"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, Highlight, ResurfaceCandidate, ResurfaceFeedback } from "@booklet/shared";
import { selectHighlightsToResurface } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { HighlightListItem } from "@/components/highlights/highlight-list-item";
import { loadArticles } from "@/lib/data/articles";
import { loadHighlights, saveHighlights } from "@/lib/data/highlights";
import { loadUserSettings } from "@/lib/mock/store";
import { compileDigestEmail, sendDigestEmail } from "@/lib/mock/digest-email";
import { useAuth } from "@/lib/auth/auth-provider";

export default function ResurfacePage() {
  const { status, isAuthenticated, user } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [batchIds, setBatchIds] = useState<string[] | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (status === "loading") return;
    Promise.all([loadArticles(isAuthenticated), loadHighlights()]).then(([loadedArticles, loadedHighlights]) => {
      setArticles(loadedArticles);
      setHighlights(loadedHighlights);

      const highlightsPerDigest = isAuthenticated && user ? user.highlightsPerDigest : loadUserSettings().highlightsPerDigest;
      const candidates: ResurfaceCandidate[] = loadedHighlights.map((h) => ({
        id: h.id,
        lastSurfacedAt: h.lastSurfacedAt,
        hasAnnotation: !!h.annotation,
        lastFeedback: h.lastFeedback,
        resurfaceArchivedAt: h.resurfaceArchivedAt,
      }));
      const selected = selectHighlightsToResurface(candidates, highlightsPerDigest);
      setBatchIds(selected.map((c) => c.id));
    });
  }, [status, isAuthenticated, user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const batch = useMemo(() => {
    if (!batchIds) return [];
    const ids = new Set(batchIds);
    return highlights.filter((h) => ids.has(h.id) && !reviewedIds.has(h.id));
  }, [highlights, batchIds, reviewedIds]);

  function applyFeedback(highlightId: string, feedback: ResurfaceFeedback | null, archive: boolean) {
    const now = new Date().toISOString();
    setHighlights((prev) => {
      const next = prev.map((h) =>
        h.id !== highlightId
          ? h
          : {
              ...h,
              lastSurfacedAt: now,
              surfaceCount: h.surfaceCount + 1,
              lastFeedback: feedback ?? h.lastFeedback,
              lastFeedbackAt: feedback ? now : h.lastFeedbackAt,
              resurfaceArchivedAt: archive ? now : h.resurfaceArchivedAt,
              updatedAt: now,
            },
      );
      saveHighlights(next);
      return next;
    });
    setReviewedIds((prev) => new Set(prev).add(highlightId));
  }

  function handleEmailDigest() {
    const content = compileDigestEmail(batch, articleById);
    sendDigestEmail(content);
    setEmailStatus("Logged to console — email sending isn't wired up yet.");
  }

  const isDone = batchIds !== null && batch.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold text-ink">Daily Review</h1>
        {batchIds && batchIds.length > 0 && (
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
            No highlights are eligible to resurface right now — check back once you've saved a few.
          </p>
        </div>
      )}

      {isDone && batchIds!.length > 0 && (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">That's everything for today. Nicely done.</p>
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
