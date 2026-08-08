"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Article, ArticleCollectionMemberships, Collection } from "@booklet/shared";
import { ArticleCard } from "@/components/library/article-card";
import { LoadError } from "@/components/ui/load-error";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { loadArticles, renameArticle, trashArticle, updateArticleFavorited, updateArticleStatus } from "@/lib/data/articles";
import { loadCollectionMemberships, loadCollections } from "@/lib/data/collections";
import { useAuth } from "@/lib/auth/auth-provider";
import { useOnTrashed } from "@/lib/dnd/trash-drop";

export default function FavoritesPage() {
  const { status, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [membership, setMembership] = useState<ArticleCollectionMemberships>({});
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [renaming, setRenaming] = useState<Article | null>(null);

  const refresh = useCallback(() => {
    if (status === "loading") return;
    Promise.all([
      loadArticles(isAuthenticated),
      loadCollections(isAuthenticated),
      loadCollectionMemberships(isAuthenticated),
    ])
      .then(([loadedArticles, loadedCollections, loadedMembership]) => {
        setArticles(loadedArticles);
        setCollections(loadedCollections);
        setMembership(loadedMembership);
        setLoaded(true);
      })
      // Without this a rejected fetch left `loaded` false forever, and the
      // page rendered nothing at all -- see components/ui/load-error.tsx.
      .catch(() => setLoadFailed(true));
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useOnTrashed(refresh);

  const favorites = useMemo(
    () => articles.filter((a) => a.favorited).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()),
    [articles],
  );

  async function handleToggleFavorited(article: Article) {
    await updateArticleFavorited(article, false, isAuthenticated);
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
  }

  async function handleToggleArchived(article: Article) {
    const nextStatus = article.status === "ARCHIVED" ? "UNREAD" : "ARCHIVED";
    const updated = await updateArticleStatus(article, nextStatus, isAuthenticated);
    setArticles((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  async function handleDelete(article: Article) {
    await trashArticle(article, isAuthenticated);
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
  }

  async function handleRenameConfirm(title: string) {
    if (!renaming) return;
    const updated = await renameArticle(renaming, title, isAuthenticated);
    setArticles((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setRenaming(null);
  }

  function handleMembershipChange(articleId: string, collectionId: string, isMember: boolean) {
    setMembership((prev) => {
      const current = prev[articleId] ?? [];
      const next = isMember ? [...current, collectionId] : current.filter((id) => id !== collectionId);
      return { ...prev, [articleId]: next };
    });
  }

  if (!loaded && loadFailed) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <h1 className="mb-6 font-serif text-2xl font-semibold text-ink">Favorites</h1>
        <LoadError message="Couldn't load your favorites. Check your connection and try again." onRetry={refresh} />
      </div>
    );
  }

  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-semibold text-ink">Favorites</h1>
      </div>

      {favorites.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">
            Nothing favorited yet — star an article from the library to see it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {favorites.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              onToggleArchived={handleToggleArchived}
              onToggleFavorited={handleToggleFavorited}
              onRename={setRenaming}
              onDelete={handleDelete}
              collections={collections}
              authenticated={isAuthenticated}
              onCollectionCreated={(c) => setCollections((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)))}
              memberCollections={collections.filter((c) => (membership[article.id] ?? []).includes(c.id))}
              onMembershipChange={(collectionId, isMember) => handleMembershipChange(article.id, collectionId, isMember)}
            />
          ))}
        </div>
      )}

      {renaming && (
        <RenameDialog
          title="Rename article"
          label="Title"
          initialValue={renaming.title ?? "Untitled"}
          onCancel={() => setRenaming(null)}
          onConfirm={handleRenameConfirm}
        />
      )}
    </div>
  );
}
