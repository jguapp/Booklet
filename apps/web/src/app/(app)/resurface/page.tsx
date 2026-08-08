"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, Highlight, ResurfaceCandidate, ResurfaceFeedback } from "@booklet/shared";
import { applySm2Review, feedbackToQuality, selectHighlightsToResurface } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { HighlightListItem } from "@/components/highlights/highlight-list-item";
import { loadArticles } from "@/lib/data/articles";
import { loadHighlights, saveHighlightPrompt, updateHighlightFeedback } from "@/lib/data/highlights";
import { emailDigest, loadCurrentDigest } from "@/lib/data/digests";
import { loadUserSettings } from "@/lib/mock/store";
import { formatNextDue } from "@/lib/format";
import { useAuth } from "@/lib/auth/auth-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { useOnTrashed } from "@/lib/dnd/trash-drop";
import { cn } from "@/lib/cn";

type LibraryTab = "REMEMBERED" | "FORGOT" | "ARCHIVED";

const LIBRARY_TABS: { value: LibraryTab; label: string }[] = [
  { value: "REMEMBERED", label: "Remembered" },
  { value: "FORGOT", label: "Forgot" },
  { value: "ARCHIVED", label: "Archived" },
];

export default function ResurfacePage() {
  const { status, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [articles, setArticles] = useState<Article[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [batchIds, setBatchIds] = useState<string[] | null>(null);
  const [digestId, setDigestId] = useState<string | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  // Which prompted highlights have had their passage revealed this session,
  // keyed by id rather than held as one "revealed" flag for the card on
  // screen: the batch is a list, and a single flag would leak across it,
  // showing the next highlight's answer before its question was even asked.
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("REMEMBERED");

  const refresh = useCallback(() => {
    if (status === "loading") return;
    loadArticles(isAuthenticated).then(async (loadedArticles) => {
      setArticles(loadedArticles);

      // loadArticles() already excludes trash -- a trashed article's
      // highlights shouldn't keep resurfacing (a stronger "I'm done with
      // this" signal than archiving, whose highlights stay eligible on
      // purpose), so filter against the article IDs that survived that.
      // The full set (not just today's batch) so the library section below
      // can browse everything that's ever been remembered/forgotten/archived,
      // not just what's currently up for review.
      const nonTrashedArticleIds = new Set(loadedArticles.map((a) => a.id));
      const loadedHighlights = (await loadHighlights(isAuthenticated)).filter((h) =>
        nonTrashedArticleIds.has(h.articleId),
      );
      setHighlights(loadedHighlights);

      if (isAuthenticated) {
        // Server picks and persists the batch (see GET /api/digests/current),
        // so a reload -- or a second device -- sees the same highlights
        // instead of a freshly re-rolled random selection.
        const digest = await loadCurrentDigest();
        setBatchIds((digest.highlights ?? []).map((h) => h.id));
        setDigestId(digest.id);
        return;
      }

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
  useOnTrashed(refresh);

  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const batch = useMemo(() => {
    if (!batchIds) return [];
    const ids = new Set(batchIds);
    return highlights.filter((h) => ids.has(h.id) && !reviewedIds.has(h.id));
  }, [highlights, batchIds, reviewedIds]);

  // Archived is checked first -- archiving is a separate, later action from
  // feedback (see applyFeedback below), so a highlight can carry a stale
  // REMEMBERED/FORGOT from before it was archived. Once archived it's
  // excluded from rotation regardless (resurface.ts's isDue()), so this is
  // the terminal bucket, checked ahead of the feedback ones.
  const libraryHighlights = useMemo(() => {
    return highlights.filter((h) => {
      if (libraryTab === "ARCHIVED") return h.resurfaceArchivedAt !== null;
      return h.resurfaceArchivedAt === null && h.lastFeedback === libraryTab;
    });
  }, [highlights, libraryTab]);

  const libraryCounts = useMemo(() => {
    const counts: Record<LibraryTab, number> = { REMEMBERED: 0, FORGOT: 0, ARCHIVED: 0 };
    for (const h of highlights) {
      if (h.resurfaceArchivedAt !== null) counts.ARCHIVED++;
      else if (h.lastFeedback === "REMEMBERED") counts.REMEMBERED++;
      else if (h.lastFeedback === "FORGOT") counts.FORGOT++;
    }
    return counts;
  }, [highlights]);

  // Restoring isn't itself a recall judgment -- unlike applyFeedback below,
  // it deliberately leaves lastFeedback/SM-2 state untouched, just clears
  // the archived flag so the highlight re-enters rotation at whatever
  // schedule it already had.
  async function handleRestore(highlightId: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await updateHighlightFeedback(target, { resurfaceArchivedAt: null }, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
    toast("Restored -- it's back in rotation.");
  }

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

  async function handleSavePrompt(highlightId: string, prompt: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await saveHighlightPrompt(target, prompt, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
    toast("Prompt saved — you'll be asked this before seeing the highlight.");
  }

  async function handleDeletePrompt(highlightId: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await saveHighlightPrompt(target, null, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
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
        {batch.map((h) => {
          // A prompted highlight is concealed until revealed. Grading is
          // withheld for exactly as long: "remembered this" answered against
          // a passage you are looking at is a recognition judgment, and
          // feeding that to SM-2 is what #157 set out to stop. Archive stays
          // available throughout -- deciding you're done with a highlight
          // isn't a recall judgment and needs no answer.
          const concealed = !!h.prompt && !revealedIds.has(h.id);
          return (
            <HighlightListItem
              key={h.id}
              highlight={h}
              article={articleById.get(h.articleId)}
              concealed={concealed}
              onReveal={() => setRevealedIds((prev) => new Set(prev).add(h.id))}
              actions={
                concealed ? (
                  <Button variant="secondary" onClick={() => applyFeedback(h.id, null, true)}>
                    Archive
                  </Button>
                ) : (
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
                )
              }
            />
          );
        })}
      </div>

      <div className="mt-12 border-t border-border pt-8">
        <button
          type="button"
          onClick={() => setShowLibrary((v) => !v)}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <div>
            <h2 className="font-serif text-lg font-semibold text-ink">Highlights library</h2>
            <p className="mt-0.5 font-sans text-sm text-ink-muted">
              Everything currently remembered, forgotten, or archived -- browse it, or move a highlight between
              sections at any time.
            </p>
          </div>
          <span className="shrink-0 font-sans text-xs font-medium text-accent">{showLibrary ? "Hide" : "Show"}</span>
        </button>

        {showLibrary && (
          <div className="mt-5">
            <div className="mb-4 flex gap-1 rounded-sm bg-surface-2 p-1">
              {LIBRARY_TABS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setLibraryTab(t.value)}
                  className={cn(
                    "flex-1 rounded-sm px-3 py-1.5 font-sans text-sm font-medium transition-colors",
                    libraryTab === t.value ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {t.label} ({libraryCounts[t.value]})
                </button>
              ))}
            </div>

            {libraryHighlights.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
                <p className="font-sans text-sm text-ink-muted">
                  {libraryTab === "REMEMBERED"
                    ? "Nothing marked as remembered yet."
                    : libraryTab === "FORGOT"
                      ? "Nothing marked as forgotten yet."
                      : "Nothing archived yet."}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {libraryHighlights.map((h) => (
                  <HighlightListItem
                    key={h.id}
                    highlight={h}
                    article={articleById.get(h.articleId)}
                    extraMeta={libraryTab === "ARCHIVED" ? "Won't resurface again" : formatNextDue(h.nextDueAt)}
                    // Never concealed here: the library is for browsing what
                    // you've reviewed, not for reviewing. It's also the one
                    // place a prompt can be written for a highlight that's
                    // already in rotation.
                    onSavePrompt={handleSavePrompt}
                    onDeletePrompt={handleDeletePrompt}
                    actions={
                      libraryTab === "ARCHIVED" ? (
                        <Button variant="secondary" onClick={() => handleRestore(h.id)}>
                          Restore
                        </Button>
                      ) : (
                        <>
                          {libraryTab !== "FORGOT" && (
                            <Button variant="secondary" onClick={() => applyFeedback(h.id, "FORGOT", false)}>
                              Forgot this
                            </Button>
                          )}
                          <Button variant="secondary" onClick={() => applyFeedback(h.id, null, true)}>
                            Archive
                          </Button>
                          {libraryTab !== "REMEMBERED" && (
                            <Button variant="primary" onClick={() => applyFeedback(h.id, "REMEMBERED", false)}>
                              Remembered this
                            </Button>
                          )}
                        </>
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
