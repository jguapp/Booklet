"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, Highlight } from "@booklet/shared";
import { HighlightListItem } from "@/components/highlights/highlight-list-item";
import { SeedCollections } from "@/components/highlights/seed-collections";
import { SharePanel } from "@/components/highlights/share-panel";
import { SourceIcon } from "@/components/library/source-icon";
import { Input } from "@/components/ui/input";
import { LoadError } from "@/components/ui/load-error";
import { IconSearch } from "@/components/ui/icons";
import { loadArticles } from "@/lib/data/articles";
import { deleteHighlight, deleteNote, loadHighlights, saveHighlightPrompt, saveNote } from "@/lib/data/highlights";
import { comparePositionInArticle } from "@/lib/highlights/position-sort";
import { useAuth } from "@/lib/auth/auth-provider";
import { useOnTrashed } from "@/lib/dnd/trash-drop";
import { useRefreshOnFocus } from "@/lib/data/use-refresh-on-focus";
import { cn } from "@/lib/cn";

type ViewMode = "grouped" | "flat";

export default function HighlightsPage() {
  const { status, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [articleFilter, setArticleFilter] = useState<string>("ALL");
  const [viewMode, setViewMode] = useState<ViewMode>("grouped");
  const [search, setSearch] = useState("");

  const refresh = useCallback(() => {
    if (status === "loading") return;
    Promise.all([loadArticles(isAuthenticated), loadHighlights(isAuthenticated)])
      .then(([a, h]) => {
        setArticles(a);
        setHighlights(h);
        setLoaded(true);
      })
      // This page has no "not loaded yet" gate -- it renders its empty state
      // straight away -- so a rejected fetch told the reader "No highlights
      // yet", which is a claim about their account rather than about the
      // request. Only the first load turns into an error block; a failed
      // refresh over something already on screen stays quiet.
      .catch(() => setLoadFailed(true));
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useOnTrashed(refresh);
  // The extension's "highlight the open web, then import" flow (see
  // apps/extension) attaches highlights to an article via the API directly
  // -- catch those up the moment this tab is looked at again, same as
  // library/page.tsx does for fresh saves.
  useRefreshOnFocus(refresh);

  const articleById = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const isSearching = search.trim().length > 0;
  // One article selected (via a group card or the dropdown), or searching --
  // either way, grouping into cards doesn't apply, show a flat list.
  const showingOneArticle = articleFilter !== "ALL";

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = highlights
      .filter((h) => articleFilter === "ALL" || h.articleId === articleFilter)
      .filter(
        (h) =>
          !needle ||
          h.selectedText.toLowerCase().includes(needle) ||
          !!h.annotation?.noteText.toLowerCase().includes(needle),
      );
    // Scoped to one article (a card was clicked, or the dropdown picked
    // one) -- reading order, so revisiting an earlier chapter later
    // doesn't scramble the list. Otherwise (mixed articles), creation
    // order is the only order that means anything across different books.
    return showingOneArticle
      ? filtered.sort(comparePositionInArticle)
      : filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [highlights, articleFilter, search, showingOneArticle]);

  const groups = useMemo(() => {
    const byArticle = new Map<string, Highlight[]>();
    for (const h of highlights) {
      const list = byArticle.get(h.articleId);
      if (list) list.push(h);
      else byArticle.set(h.articleId, [h]);
    }
    return Array.from(byArticle.entries())
      .map(([articleId, hs]) => ({
        article: articleById.get(articleId),
        articleId,
        count: hs.length,
        mostRecentAt: Math.max(...hs.map((h) => new Date(h.createdAt).getTime())),
      }))
      .sort((a, b) => b.mostRecentAt - a.mostRecentAt);
  }, [highlights, articleById]);

  // Grouping only means something with 2+ books -- with just one, it's a
  // single card that hides your highlights behind an extra click instead
  // of showing them.
  const canGroup = groups.length > 1;
  const showGrouped = viewMode === "grouped" && canGroup && !showingOneArticle && !isSearching;

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

  // Writing prompts is a browsing-time activity -- you go through a book's
  // highlights and turn the ones worth remembering into questions -- which
  // makes this page, not the reader, where it belongs.
  async function handleSavePrompt(highlightId: string, prompt: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await saveHighlightPrompt(target, prompt, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
  }

  async function handleDeletePrompt(highlightId: string) {
    const target = highlights.find((h) => h.id === highlightId);
    if (!target) return;
    const updated = await saveHighlightPrompt(target, null, isAuthenticated);
    setHighlights((prev) => prev.map((h) => (h.id === highlightId ? updated : h)));
  }

  const selectedArticle = showingOneArticle ? articleById.get(articleFilter) : undefined;

  if (!loaded && loadFailed) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-10">
        <h1 className="mb-6 font-serif text-2xl font-semibold text-ink">Highlights</h1>
        <LoadError message="Couldn't load your highlights. Check your connection and try again." onRetry={refresh} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-6">
        {showingOneArticle ? (
          <>
            <button
              type="button"
              onClick={() => setArticleFilter("ALL")}
              className="mb-1 font-sans text-xs font-medium text-accent hover:underline"
            >
              ← All highlights
            </button>
            <h1 className="font-serif text-2xl font-semibold text-ink">
              {selectedArticle?.title ?? "Untitled"}
            </h1>
            {/* Sharing is offered per article, and only once one is in view
                (#158) -- a link to "all your highlights" would publish every
                book you have ever read, which is not a thing anyone means to
                send to a friend. */}
            <div className="mt-4">
              {/* Keyed so switching articles remounts it: without that, the
                  panel keeps showing the previous article's link until its
                  refetch lands, and a share URL for the wrong page is the
                  one stale value here that could actually be copied and
                  sent. */}
              <SharePanel key={articleFilter} articleId={articleFilter} authenticated={isAuthenticated} />
            </div>
          </>
        ) : (
          <h1 className="font-serif text-2xl font-semibold text-ink">Highlights</h1>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-[280px]">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            type="text"
            aria-label="Search your highlights"
            placeholder="Search highlights, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9"
          />
        </div>

        <select
          aria-label="Filter by article"
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

        {canGroup && !showingOneArticle && !isSearching && (
          <div className="flex gap-1 rounded-sm bg-surface-2 p-1" role="group" aria-label="Highlights view">
            <button
              type="button"
              onClick={() => setViewMode("grouped")}
              className={cn(
                "rounded-sm px-3 py-1.5 font-sans text-sm font-medium transition-colors",
                viewMode === "grouped" ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              By book
            </button>
            <button
              type="button"
              onClick={() => setViewMode("flat")}
              className={cn(
                "rounded-sm px-3 py-1.5 font-sans text-sm font-medium transition-colors",
                viewMode === "flat" ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              All
            </button>
          </div>
        )}
      </div>

      {showGrouped ? (
        groups.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
            <p className="font-sans text-sm text-ink-muted">No highlights yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((g) => (
              <button
                key={g.articleId}
                type="button"
                onClick={() => setArticleFilter(g.articleId)}
                className="flex items-center gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-accent/40"
              >
                <SourceIcon
                  sourceType={g.article?.sourceType ?? "HTML"}
                  className="h-4 w-4 shrink-0 text-ink-faint"
                />
                <span className="min-w-0 flex-1 truncate font-serif text-base text-ink">
                  {g.article?.title ?? "Untitled"}
                </span>
                <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 font-sans text-xs text-ink-muted">
                  {g.count} highlight{g.count === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
        )
      ) : visible.length === 0 ? (
        <div>
          <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
            <p className="font-sans text-sm text-ink-muted">
              {search.trim() ? "No highlights match that search." : "No highlights yet for this filter."}
            </p>
          </div>
          {/* Only when the library is genuinely empty, not when a filter or
              search happens to match nothing -- someone with 400 highlights
              searching for a word they didn't use is not looking for
              onboarding suggestions. */}
          {highlights.length === 0 && !isSearching && <SeedCollections />}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((h) => (
            <HighlightListItem
              key={h.id}
              highlight={h}
              article={showingOneArticle ? undefined : articleById.get(h.articleId)}
              articleExtractedText={articleById.get(h.articleId)?.extractedText}
              onDelete={handleDelete}
              onSaveNote={handleSaveNote}
              onDeleteNote={handleDeleteNote}
              onSavePrompt={handleSavePrompt}
              onDeletePrompt={handleDeletePrompt}
            />
          ))}
        </div>
      )}
    </div>
  );
}
