"use client";

import { useCallback, useEffect, useState } from "react";
import type { Article } from "@booklet/shared";
import { computeReadingStats } from "@booklet/shared";
import { loadArticles } from "@/lib/data/articles";
import { useAuth } from "@/lib/auth/auth-provider";
import { useOnTrashed } from "@/lib/dnd/trash-drop";

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-5 py-6 text-center">
      <p className="font-serif text-3xl font-semibold text-ink">{value}</p>
      <p className="mt-1 font-sans text-xs uppercase tracking-wide text-ink-faint">{label}</p>
    </div>
  );
}

export default function StatsPage() {
  const { status, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[] | null>(null);

  const refresh = useCallback(() => {
    if (status === "loading") return;
    loadArticles(isAuthenticated).then(setArticles);
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useOnTrashed(refresh);

  if (!articles) return null;

  const stats = computeReadingStats(articles);

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-2xl font-semibold text-ink">Stats</h1>
      </div>

      {stats.totalArticles === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">
            Nothing saved yet -- stats show up once you start reading.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Day streak" value={String(stats.currentStreakDays)} />
          <StatCard label="Time spent" value={formatDuration(stats.totalReadingSeconds)} />
          <StatCard label="Completion rate" value={`${Math.round(stats.completionRate * 100)}%`} />
          <StatCard label="Finished" value={`${stats.finishedArticles} / ${stats.totalArticles}`} />
        </div>
      )}
    </div>
  );
}
