"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, Highlight } from "@booklet/shared";
import { HighlightListItem } from "@/components/highlights/highlight-list-item";
import { loadArticles } from "@/lib/data/articles";
import { loadHighlights, saveHighlights, LOCAL_USER_ID } from "@/lib/data/highlights";
import { useAuth } from "@/lib/auth/auth-provider";

export default function HighlightsPage() {
  const { status, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [articleFilter, setArticleFilter] = useState<string>("ALL");

  const refresh = useCallback(() => {
    if (status === "loading") return;
    Promise.all([loadArticles(isAuthenticated), loadHighlights()]).then(([a, h]) => {
      setArticles(a);
      setHighlights(h);
    });
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const visible = useMemo(() => {
    return highlights
      .filter((h) => articleFilter === "ALL" || h.articleId === articleFilter)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [highlights, articleFilter]);

  function handleDelete(highlightId: string) {
    setHighlights((prev) => {
      const next = prev.filter((h) => h.id !== highlightId);
      saveHighlights(next);
      return next;
    });
  }

  function handleSaveNote(highlightId: string, noteText: string) {
    const now = new Date().toISOString();
    setHighlights((prev) => {
      const next = prev.map((h) => {
        if (h.id !== highlightId) return h;
        return {
          ...h,
          annotation: h.annotation
            ? { ...h.annotation, noteText, updatedAt: now }
            : {
                id: `local-${crypto.randomUUID()}`,
                highlightId,
                userId: LOCAL_USER_ID,
                noteText,
                createdAt: now,
                updatedAt: now,
              },
        };
      });
      saveHighlights(next);
      return next;
    });
  }

  function handleDeleteNote(highlightId: string) {
    setHighlights((prev) => {
      const next = prev.map((h) => (h.id === highlightId ? { ...h, annotation: null } : h));
      saveHighlights(next);
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold text-ink">Highlights</h1>

        <select
          value={articleFilter}
          onChange={(e) => setArticleFilter(e.target.value)}
          className="rounded-sm border border-border bg-surface px-3 py-2 font-sans text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="ALL">All articles</option>
          {articles.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title ?? "Untitled"}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">No highlights yet for this filter.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((h) => (
            <HighlightListItem
              key={h.id}
              highlight={h}
              article={articleById.get(h.articleId)}
              onDelete={handleDelete}
              onSaveNote={handleSaveNote}
              onDeleteNote={handleDeleteNote}
            />
          ))}
        </div>
      )}
    </div>
  );
}
