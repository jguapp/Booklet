"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Article, ArticleStatus, Collection, Highlight } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconSearch } from "@/components/ui/icons";
import { ArticleCard } from "@/components/library/article-card";
import { SaveArticleModal } from "@/components/library/save-article-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { loadArticles, trashArticle, updateArticleFavorited, updateArticleStatus } from "@/lib/data/articles";
import { loadArticlesInCollection, loadCollections } from "@/lib/data/collections";
import { searchLibrary } from "@/lib/data/search";
import { loadHoardingPrefs } from "@/lib/data/hoarding-prefs";
import { useAuth } from "@/lib/auth/auth-provider";
import { useOnTrashed } from "@/lib/dnd/trash-drop";

type FilterTab = "ALL" | ArticleStatus;

const TABS: { value: FilterTab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "UNREAD", label: "Unread" },
  { value: "READING", label: "Reading" },
  { value: "ARCHIVED", label: "Archived" },
];

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryPageInner />
    </Suspense>
  );
}

function LibraryPageInner() {
  const { status, isAuthenticated, lastSyncResult, dismissSyncResult } = useAuth();
  const searchParams = useSearchParams();
  const collectionId = searchParams.get("collection");

  const [articles, setArticles] = useState<Article[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Defaults to "Reading" (what's actually in progress) rather than "All"
  // (the entire, potentially-overwhelming backlog) -- see the "knowledge
  // hoarding" toggle below for the same underlying concern. A fresh save is
  // always UNREAD, so handleSaved switches to that tab specifically --
  // otherwise something you just saved would appear to vanish.
  const [tab, setTab] = useState<FilterTab>("READING");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ articles: Article[]; highlights: Highlight[] } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmingHoarding, setConfirmingHoarding] = useState<number | null>(null); // current unread count, while the "you sure?" prompt is up

  const refresh = useCallback(() => {
    if (status === "loading") return;
    Promise.all([
      collectionId ? loadArticlesInCollection(collectionId, isAuthenticated) : loadArticles(isAuthenticated),
      loadCollections(isAuthenticated),
    ]).then(([loadedArticles, loadedCollections]) => {
      setArticles(loadedArticles as Article[]);
      setCollections(loadedCollections);
      setLoaded(true);
    });
  }, [status, isAuthenticated, collectionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useOnTrashed(refresh); // a drag-and-drop trash drop elsewhere (app layout) doesn't touch this page's own state

  // Debounced so authenticated mode (which asks the server -- see
  // lib/data/search.ts for why the already-loaded article list can't
  // answer a body-text search itself) isn't doing it on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    async function runSearch() {
      if (!debouncedSearch) {
        setSearchResults(null);
        return;
      }
      const results = await searchLibrary(debouncedSearch, isAuthenticated);
      if (!cancelled) setSearchResults(results as { articles: Article[]; highlights: Highlight[] });
    }
    runSearch();
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, isAuthenticated]);

  const activeCollection = useMemo(
    () => collections.find((c) => c.id === collectionId) ?? null,
    [collections, collectionId],
  );

  const allTags = useMemo(() => [...new Set(articles.flatMap((a) => a.tags))].sort(), [articles]);

  const isSearching = debouncedSearch.length > 0;
  const visible = useMemo(() => {
    const base = isSearching ? (searchResults?.articles ?? []) : articles;
    return base
      .filter((a) => tab === "ALL" || a.status === tab)
      .filter((a) => !tagFilter || a.tags.includes(tagFilter))
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }, [articles, searchResults, isSearching, tab, tagFilter]);

  function handleSaveClick() {
    const hoarding = loadHoardingPrefs();
    const unreadCount = articles.filter((a) => a.status === "UNREAD").length;
    if (hoarding.enabled && unreadCount >= hoarding.maxUnread) {
      setConfirmingHoarding(unreadCount);
      return;
    }
    setModalOpen(true);
  }

  function handleSaved(article: Article) {
    setArticles((prev) => [article, ...prev]);
    setModalOpen(false);
    setTab("UNREAD");
  }

  async function handleToggleArchived(article: Article) {
    const nextStatus = article.status === "ARCHIVED" ? "UNREAD" : "ARCHIVED";
    const updated = await updateArticleStatus(article, nextStatus, isAuthenticated);
    setArticles((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  async function handleToggleFavorited(article: Article) {
    const updated = await updateArticleFavorited(article, !article.favorited, isAuthenticated);
    setArticles((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  async function handleDelete(article: Article) {
    await trashArticle(article, isAuthenticated);
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
  }

  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">
            {activeCollection ? activeCollection.name : "Library"}
          </h1>
          {activeCollection && (
            <a href="/library" className="font-sans text-xs font-medium text-accent">
              ← All articles
            </a>
          )}
        </div>
        <Button variant="primary" onClick={handleSaveClick}>
          Save article
        </Button>
      </div>

      {lastSyncResult &&
        (lastSyncResult.importedArticles > 0 ||
          lastSyncResult.importedHighlights > 0 ||
          lastSyncResult.importedCollections > 0) && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-sm border border-accent/30 bg-accent/10 px-4 py-2.5">
            <p className="font-sans text-sm text-ink">
              Synced {lastSyncResult.importedArticles} article{lastSyncResult.importedArticles === 1 ? "" : "s"},{" "}
              {lastSyncResult.importedHighlights} highlight{lastSyncResult.importedHighlights === 1 ? "" : "s"}, and{" "}
              {lastSyncResult.importedCollections} collection{lastSyncResult.importedCollections === 1 ? "" : "s"}{" "}
              from this device to your account.
            </p>
            <button
              type="button"
              onClick={dismissSyncResult}
              className="shrink-0 font-sans text-xs font-medium text-ink-muted hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        )}

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1 rounded-sm bg-surface-2 p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                "rounded-sm px-3 py-1.5 font-sans text-sm font-medium transition-colors",
                tab === t.value ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative w-full max-w-[280px]">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            type="text"
            placeholder="Search titles, text, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9"
          />
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTagFilter((prev) => (prev === tag ? null : tag))}
              className={cn(
                "rounded-full border px-2.5 py-1 font-sans text-xs transition-colors",
                tagFilter === tag
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface text-ink-muted hover:text-ink",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">
            {isSearching
              ? "No articles match that search."
              : tagFilter
                ? `No articles tagged "${tagFilter}".`
                : activeCollection
                  ? "No articles in this collection yet."
                  : "Nothing here yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visible.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              onToggleArchived={handleToggleArchived}
              onToggleFavorited={handleToggleFavorited}
              onDelete={handleDelete}
              collections={collections}
              authenticated={isAuthenticated}
            />
          ))}
        </div>
      )}

      {isSearching && searchResults && searchResults.highlights.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Highlights</h2>
          <div className="flex flex-col gap-2">
            {searchResults.highlights.map((h) => (
              <Link
                key={h.id}
                href={`/reader/${h.articleId}`}
                className="block rounded-md border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/40"
              >
                <p className="font-serif text-sm text-ink">&ldquo;{h.selectedText}&rdquo;</p>
                {h.annotation && (
                  <p className="mt-1 font-sans text-xs text-ink-muted">{h.annotation.noteText}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {modalOpen && (
        <SaveArticleModal authenticated={isAuthenticated} onClose={() => setModalOpen(false)} onSaved={handleSaved} />
      )}

      {confirmingHoarding !== null && (
        <ConfirmDialog
          title="Your unread pile is growing"
          message={`You have ${confirmingHoarding} unread articles already. Consider reading or archiving one before saving more.`}
          confirmLabel="Save anyway"
          cancelLabel="Not now"
          danger={false}
          onCancel={() => setConfirmingHoarding(null)}
          onConfirm={() => {
            setConfirmingHoarding(null);
            setModalOpen(true);
          }}
        />
      )}
    </div>
  );
}
