"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, ReadingActivityDay, SourceType } from "@booklet/shared";
import { computeReadingStats } from "@booklet/shared";
import { loadArticles } from "@/lib/data/articles";
import { loadReadingActivity } from "@/lib/data/reading-activity";
import { useAuth } from "@/lib/auth/auth-provider";
import { useOnTrashed } from "@/lib/dnd/trash-drop";
import { SourceIcon } from "@/components/library/source-icon";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/cn";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-5 py-6 text-center">
      <p className="font-serif text-3xl font-semibold text-ink">{value}</p>
      <p className="mt-1 font-sans text-xs uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}

// A full year, GitHub-contributions-style -- matches what
// /api/stats/reading-activity itself returns (see that route's own
// comment). The archivedAt-based fallback (anonymous/local mode, which has
// no per-day data to ask the server for) uses the same window so both
// sources lay out into the same size grid.
const HEATMAP_WEEKS = 53;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const HEAT_LEVEL_CLASS = ["bg-surface-2", "bg-accent/30", "bg-accent/55", "bg-accent/80", "bg-accent"];

interface HeatmapDay {
  date: Date;
  level: number;
  tooltip: string;
}

/** Real per-day reading time -- level buckets are minutes read, not article
 * counts, since that's what this data actually measures (see
 * ReadingActivityDay's own schema comment for why article-level events
 * alone undercount real reading activity). */
function levelFromMinutes(minutes: number): number {
  if (minutes <= 0) return 0;
  if (minutes < 10) return 1;
  if (minutes < 25) return 2;
  if (minutes < 45) return 3;
  return 4;
}

/** Articles *finished* that day -- the only signal available without a
 * signed-in account's server-tracked history (see loadReadingActivity's own
 * comment). Undercounts real reading activity (a day spent partway through
 * an article, finishing nothing, shows as blank) but is better than an
 * empty heatmap for anonymous/local-mode use. */
function levelFromFinishedCount(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

/** Last HEATMAP_WEEKS*7 days, oldest first, as a flat list -- rendered into
 * a 7-row (Sun-Sat) grid below by chunking every 7 into a week column.
 * `activity` (real per-day reading seconds) is preferred when available;
 * falls back to deriving from articles' own archivedAt otherwise. */
function computeDailyActivity(articles: Article[], activity: ReadingActivityDay[] | null): HeatmapDay[] {
  const minutesByDay = new Map<string, number>();
  const finishedByDay = new Map<string, number>();
  if (activity) {
    for (const a of activity) minutesByDay.set(a.date, a.seconds / 60);
  } else {
    for (const a of articles) {
      if (!a.archivedAt) continue;
      const key = dayKey(new Date(a.archivedAt));
      finishedByDay.set(key, (finishedByDay.get(key) ?? 0) + 1);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Align the grid to end on a Saturday and start on a Sunday, GitHub-style,
  // so full weeks stack into clean columns.
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const totalDays = HEATMAP_WEEKS * 7;
  const start = new Date(end);
  start.setDate(start.getDate() - totalDays + 1);

  const days: HeatmapDay[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = dayKey(d);
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (d > today) {
      days.push({ date: d, level: 0, tooltip: `${label}: no data yet` });
    } else if (activity) {
      const minutes = minutesByDay.get(key) ?? 0;
      days.push({ date: d, level: levelFromMinutes(minutes), tooltip: `${label}: ${Math.round(minutes)} min read` });
    } else {
      const count = finishedByDay.get(key) ?? 0;
      days.push({ date: d, level: levelFromFinishedCount(count), tooltip: `${label}: ${count} finished` });
    }
  }
  return days;
}

function ActivityHeatmap({ articles, activity }: { articles: Article[]; activity: ReadingActivityDay[] | null }) {
  const days = useMemo(() => computeDailyActivity(articles, activity), [articles, activity]);
  const weeks = useMemo(() => {
    const cols: HeatmapDay[][] = [];
    for (let i = 0; i < days.length; i += 7) cols.push(days.slice(i, i + 7));
    return cols;
  }, [days]);

  return (
    <div className="flex gap-[3px] overflow-x-auto pb-1">
      {weeks.map((week, i) => (
        <div key={i} className="flex flex-col gap-[3px]">
          {week.map(({ date, level, tooltip }) => (
            <div
              key={dayKey(date)}
              title={tooltip}
              className={cn("h-[11px] w-[11px] rounded-[2px]", HEAT_LEVEL_CLASS[level])}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TopTags({ articles }: { articles: Article[] }) {
  const ranked = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of articles) for (const tag of a.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [articles]);

  if (ranked.length === 0) return <p className="font-sans text-sm text-ink-faint">No tags yet.</p>;

  const max = ranked[0][1];
  return (
    <div className="flex flex-col gap-2">
      {ranked.map(([tag, count]) => (
        <div key={tag} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate font-sans text-sm text-ink">{tag}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(count / max) * 100}%` }} />
          </div>
          <span className="w-6 shrink-0 text-right font-sans text-xs text-ink-faint">{count}</span>
        </div>
      ))}
    </div>
  );
}

function SourceBreakdown({ articles }: { articles: Article[] }) {
  const counts = useMemo(() => {
    const c: Record<SourceType, number> = { HTML: 0, PDF: 0, EPUB: 0, BOOK: 0 };
    for (const a of articles) c[a.sourceType]++;
    return c;
  }, [articles]);

  const total = articles.length || 1;
  const entries = (["HTML", "PDF", "EPUB", "BOOK"] as SourceType[]).filter((t) => counts[t] > 0);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {entries.map((type) => (
        <div key={type} className="flex items-center gap-3">
          <SourceIcon sourceType={type} className="h-4 w-4 shrink-0 text-ink-faint" />
          <span className="w-14 shrink-0 font-sans text-sm text-ink">{type}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(counts[type] / total) * 100}%` }} />
          </div>
          <span className="w-8 shrink-0 text-right font-sans text-xs text-ink-faint">{counts[type]}</span>
        </div>
      ))}
    </div>
  );
}

export default function StatsPage() {
  const { status, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[] | null>(null);
  // null while loading *or* for anonymous/local mode (no server history to
  // ask for) -- ActivityHeatmap falls back to the archivedAt heuristic in
  // both cases, so there's no separate loading state to track here.
  const [activity, setActivity] = useState<ReadingActivityDay[] | null>(null);

  const refresh = useCallback(() => {
    if (status === "loading") return;
    loadArticles(isAuthenticated).then(setArticles);
    loadReadingActivity(isAuthenticated).then((res) => setActivity(res?.days ?? null));
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useOnTrashed(refresh);

  if (!articles) return null;

  const stats = computeReadingStats(articles);
  const avgSecondsPerFinished = stats.finishedArticles > 0 ? stats.totalReadingSeconds / stats.finishedArticles : 0;

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-serif text-2xl font-semibold text-ink">Stats</h1>
        <Link href="/recap" className="font-sans text-xs font-medium text-accent hover:underline">
          View your Recap →
        </Link>
      </div>

      {stats.totalArticles === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">
            Nothing saved yet -- stats show up once you start reading.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-10">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Day streak" value={String(stats.currentStreakDays)} />
            <StatCard label="Longest streak" value={String(stats.longestStreakDays)} />
            <StatCard label="Time spent" value={formatDuration(stats.totalReadingSeconds)} />
            <StatCard label="Completion rate" value={`${Math.round(stats.completionRate * 100)}%`} />
            <StatCard label="Finished" value={`${stats.finishedArticles} / ${stats.totalArticles}`} />
            <StatCard label="Avg. per article" value={avgSecondsPerFinished > 0 ? formatDuration(avgSecondsPerFinished) : "--"} />
          </div>

          <section>
            <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Days read, past year
            </h2>
            <div className="rounded-md border border-border bg-surface px-5 py-4">
              <ActivityHeatmap articles={articles} activity={activity} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">Top tags</h2>
            <div className="rounded-md border border-border bg-surface px-5 py-4">
              <TopTags articles={articles} />
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-faint">By source</h2>
            <div className="rounded-md border border-border bg-surface px-5 py-4">
              <SourceBreakdown articles={articles} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
