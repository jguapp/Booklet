"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, ArticleStatus } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconSearch } from "@/components/ui/icons";
import { ArticleCard } from "@/components/library/article-card";
import { SaveArticleModal } from "@/components/library/save-article-modal";
import { cn } from "@/lib/cn";
import { loadArticles, updateArticleStatus } from "@/lib/data/articles";
import { useAuth } from "@/lib/auth/auth-provider";

type FilterTab = "ALL" | ArticleStatus;

const TABS: { value: FilterTab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "UNREAD", label: "Unread" },
  { value: "READING", label: "Reading" },
  { value: "ARCHIVED", label: "Archived" },
];

export default function LibraryPage() {
  const { status, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<FilterTab>("ALL");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(() => {
    if (status === "loading") return;
    loadArticles(isAuthenticated).then((loadedArticles) => {
      setArticles(loadedArticles);
      setLoaded(true);
    });
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold text-ink">Library</h1>
        <Button variant="primary" onClick={() => setModalOpen(true)}>
          Save article
        </Button>
      </div>

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
            {search ? "No articles match that search." : "Nothing here yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visible.map((article) => (
            <ArticleCard key={article.id} article={article} onToggleArchived={handleToggleArchived} />
          ))}
        </div>
      )}

      {modalOpen && (
        <SaveArticleModal authenticated={isAuthenticated} onClose={() => setModalOpen(false)} onSaved={handleSaved} />
      )}
    </div>
  );
}
