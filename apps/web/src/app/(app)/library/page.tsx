"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Article, ArticleStatus, Collection } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconSearch } from "@/components/ui/icons";
import { ArticleCard } from "@/components/library/article-card";
import { SaveArticleModal } from "@/components/library/save-article-modal";
import { cn } from "@/lib/cn";
import { deleteArticle, loadArticles, updateArticleStatus } from "@/lib/data/articles";
import { loadArticlesInCollection, loadCollections } from "@/lib/data/collections";
import { useAuth } from "@/lib/auth/auth-provider";

type FilterTab = "ALL" | ArticleStatus;

const TABS: { value: FilterTab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "UNREAD", label: "Unread" },
  { value: "READING", label: "Reading" },
  { value: "ARCHIVED", label: "Archived" },
];

export default function LibraryPage() {
  const { status, isAuthenticated, lastSyncResult, dismissSyncResult } = useAuth();
  const searchParams = useSearchParams();
  const collectionId = searchParams.get("collection");

  const [articles, setArticles] = useState<Article[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<FilterTab>("ALL");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

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

  const activeCollection = useMemo(
    () => collections.find((c) => c.id === collectionId) ?? null,
    [collections, collectionId],
  );

  const visible = useMemo(() => {
    return articles
      .filter((a) => tab === "ALL" || a.status === tab)
      .filter((a) => (a.title ?? "").toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }, [articles, tab, search]);

  function handleSaved(article: Article) {
    setArticles((prev) => [article, ...prev]);
    setModalOpen(false);
  }

  async function handleToggleArchived(article: Article) {
    const nextStatus = article.status === "ARCHIVED" ? "UNREAD" : "ARCHIVED";
    const updated = await updateArticleStatus(article, nextStatus, isAuthenticated);
    setArticles((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  async function handleDelete(article: Article) {
    await deleteArticle(article.id, isAuthenticated);
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
        <Button variant="primary" onClick={() => setModalOpen(true)}>
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

        <div className="relative w-full max-w-[220px]">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            type="text"
            placeholder="Search by title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">
            {search
              ? "No articles match that search."
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
              onDelete={handleDelete}
              collections={collections}
              authenticated={isAuthenticated}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <SaveArticleModal authenticated={isAuthenticated} onClose={() => setModalOpen(false)} onSaved={handleSaved} />
      )}
    </div>
  );
}
