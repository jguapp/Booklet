"use client";

import { useCallback, useEffect, useState } from "react";
import type { Article } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LoadError } from "@/components/ui/load-error";
import { SourceIcon } from "@/components/library/source-icon";
import { formatDaysRemaining, formatRelativeDate } from "@/lib/format";
import { emptyTrash, loadTrash, permanentlyDeleteArticle, restoreArticle } from "@/lib/data/articles";
import { useAuth } from "@/lib/auth/auth-provider";

const TRASH_RETENTION_DAYS = 30;

export default function TrashPage() {
  const { status, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);

  const refresh = useCallback(() => {
    if (status === "loading") return;
    loadTrash(isAuthenticated)
      .then((loadedArticles) => {
        setArticles(loadedArticles);
        setLoaded(true);
      })
      // Without this a rejected fetch left `loaded` false forever, and the
      // page rendered nothing at all -- see components/ui/load-error.tsx.
      .catch(() => setLoadFailed(true));
  }, [status, isAuthenticated]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleRestore(article: Article) {
    await restoreArticle(article, isAuthenticated);
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
  }

  async function handleDeleteForever(article: Article) {
    await permanentlyDeleteArticle(article.id, isAuthenticated);
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
    setDeletingId(null);
  }

  async function handleEmptyTrash() {
    await emptyTrash(isAuthenticated);
    setArticles([]);
    setConfirmingEmpty(false);
  }

  if (!loaded && loadFailed) {
    return (
      <div className="mx-auto max-w-2xl px-8 py-10">
        <h1 className="mb-6 font-serif text-2xl font-semibold text-ink">Trash</h1>
        <LoadError message="Couldn't load your trash. Check your connection and try again." onRetry={refresh} />
      </div>
    );
  }

  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold text-ink">Trash</h1>
        {articles.length > 0 && (
          <Button variant="secondary" onClick={() => setConfirmingEmpty(true)}>
            Empty trash
          </Button>
        )}
      </div>
      <p className="mb-8 font-sans text-sm text-ink-muted">
        Deleted articles stay here for {TRASH_RETENTION_DAYS} days before being permanently removed.
      </p>

      {articles.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
          <p className="font-sans text-sm text-ink-muted">Trash is empty.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {articles.map((article) => (
            <div
              key={article.id}
              className="flex items-center gap-3 rounded-md border border-border bg-surface px-5 py-4"
            >
              <SourceIcon sourceType={article.sourceType} className="h-4 w-4 shrink-0 text-ink-faint" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-serif text-base font-semibold text-ink">{article.title ?? "Untitled"}</p>
                <p className="font-sans text-xs text-ink-faint">
                  Trashed {formatRelativeDate(article.deletedAt!)} ·{" "}
                  {formatDaysRemaining(article.deletedAt!, TRASH_RETENTION_DAYS)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => handleRestore(article)} className="px-3 py-1.5 text-xs">
                  Restore
                </Button>
                <Button variant="ghost" onClick={() => setDeletingId(article.id)} className="px-3 py-1.5 text-xs">
                  Delete forever
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {deletingId && (
        <ConfirmDialog
          title="Delete this article forever?"
          message="This permanently removes it and its highlights. This can't be undone."
          onCancel={() => setDeletingId(null)}
          onConfirm={() => {
            const target = articles.find((a) => a.id === deletingId);
            if (target) handleDeleteForever(target);
          }}
        />
      )}

      {confirmingEmpty && (
        <ConfirmDialog
          title="Empty trash?"
          message={`Permanently deletes all ${articles.length} article${articles.length === 1 ? "" : "s"} in trash and their highlights. This can't be undone.`}
          confirmLabel="Empty trash"
          onCancel={() => setConfirmingEmpty(false)}
          onConfirm={handleEmptyTrash}
        />
      )}
    </div>
  );
}
