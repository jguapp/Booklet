"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, Highlight } from "@booklet/shared";
import { HighlightListItem } from "@/components/highlights/highlight-list-item";
import { Input } from "@/components/ui/input";
import { IconSearch } from "@/components/ui/icons";
import { loadArticles } from "@/lib/data/articles";
import { deleteHighlight, deleteNote, loadHighlights, saveNote } from "@/lib/data/highlights";
import { useAuth } from "@/lib/auth/auth-provider";

export default function HighlightsPage() {
  const { status, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [articleFilter, setArticleFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const refresh = useCallback(() => {
    if (status === "loading") return;
    Promise.all([loadArticles(isAuthenticated), loadHighlights(isAuthenticated)]).then(([a, h]) => {
      setArticles(a);
      setHighlights(h);
    });
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return highlights
      .filter((h) => articleFilter === "ALL" || h.articleId === articleFilter)
      .filter(
        (h) =>
          !needle ||
          h.selectedText.toLowerCase().includes(needle) ||
          !!h.annotation?.noteText.toLowerCase().includes(needle),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [highlights, articleFilter, search]);

  async function handleDelete(highlightId: string) {
    await deleteHighlight(highlightId, isAuthenticated);
    setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
  }

  async function handleSaveNote(highlightId: string, noteText: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await saveNote(target, noteText, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
  }

  async function handleDeleteNote(highlightId: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await deleteNote(target, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold text-ink">Highlights</h1>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-[240px]">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input
              type="text"
              placeholder="Search highlights, notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9"
            />
          </div>

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
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">
            {search.trim() ? "No highlights match that search." : "No highlights yet for this filter."}
          </p>
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
