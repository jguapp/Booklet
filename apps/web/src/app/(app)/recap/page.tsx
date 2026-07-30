"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Article } from "@booklet/shared";
import { computeRecap, type RecapPeriod } from "@booklet/shared";
import { loadArticles } from "@/lib/data/articles";
import { useAuth } from "@/lib/auth/auth-provider";
import { useOnTrashed } from "@/lib/dnd/trash-drop";
import { useToast } from "@/lib/toast/toast-provider";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * A time-boxed slice of the same data Stats already computes (see
 * computeRecap, packages/shared/recap.ts) -- a "wrapped"-style pushed
 * summary rather than something you have to remember to go check. No
 * email delivery yet (this app has no cron/scheduled-job runner at all
 * today -- that's real infra this issue doesn't build on its own) and no
 * generated share-image; "Copy summary" gives a plain-text version
 * that's honest about not including specific article titles unless
 * that's genuinely fine to share, which is why it's opt-in text, not an
 * auto-generated image with your reading history baked into pixels.
 */

const PERIODS: { value: RecapPeriod; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

function BigStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="font-serif text-4xl font-semibold text-ink">{value}</p>
      <p className="mt-1 font-sans text-xs uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}

export default function RecapPage() {
  const { status, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [period, setPeriod] = useState<RecapPeriod>("week");

  const refresh = useCallback(() => {
    if (status === "loading") return;
    loadArticles(isAuthenticated).then(setArticles);
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useOnTrashed(refresh);

  const recap = useMemo(() => (articles ? computeRecap(articles, period) : null), [articles, period]);

  if (!articles || !recap) return null;

  const periodLabel = period === "week" ? "This week" : "This month";

  async function handleCopySummary() {
    if (!recap) return;
    const lines = [
      `My Booklet Recap -- ${periodLabel}`,
      `${recap.articlesSaved} article${recap.articlesSaved === 1 ? "" : "s"} saved`,
      `${recap.articlesFinished} finished (${formatDuration(recap.timeSpentSeconds)} of reading)`,
      `${recap.currentStreakDays}-day streak (longest: ${recap.longestStreakDays})`,
      ...(recap.topTags.length > 0 ? [`Top tags: ${recap.topTags.map((t) => t.tag).join(", ")}`] : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("Copied your Recap to the clipboard.");
    } catch {
      toast("Couldn't copy -- your browser blocked clipboard access.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">Your Recap</h1>
          <Link href="/stats" className="font-sans text-xs font-medium text-accent hover:underline">
            ← Full stats
          </Link>
        </div>
        <div className="flex gap-1 rounded-sm bg-surface-2 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={cn(
                "rounded-sm px-3 py-1.5 font-sans text-sm font-medium transition-colors",
                period === p.value ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-gradient-to-br from-accent/10 to-transparent px-8 py-10">
        <p className="mb-8 text-center font-sans text-sm text-ink-muted">{periodLabel} in Booklet</p>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <BigStat value={String(recap.articlesSaved)} label="Saved" />
          <BigStat value={String(recap.articlesFinished)} label="Finished" />
          <BigStat value={formatDuration(recap.timeSpentSeconds)} label="Time reading" />
          <BigStat value={String(recap.currentStreakDays)} label="Day streak" />
        </div>

        {recap.topTags.length > 0 && (
          <div className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
            {recap.topTags.map((t) => (
              <span
                key={t.tag}
                className="rounded-full border border-border bg-surface px-2.5 py-1 font-sans text-xs text-ink-muted"
              >
                {t.tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-center">
        <button
          type="button"
          onClick={handleCopySummary}
          className="rounded-sm border border-border bg-surface px-4 py-2 font-sans text-sm font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Copy summary
        </button>
      </div>

      <p className="mt-8 text-center font-sans text-xs text-ink-faint">
        Recap doesn&apos;t email itself to you yet -- for now, it&apos;s here whenever you want to check in.
      </p>
    </div>
  );
}
