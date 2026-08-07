"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Article, ArticleCollectionMemberships, ArticleStatus, Collection, Highlight } from "@booklet/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconSearch } from "@/components/ui/icons";
import { ArticleCard } from "@/components/library/article-card";
import { SaveArticleModal } from "@/components/library/save-article-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { cn } from "@/lib/cn";
import { loadArticles, renameArticle, trashArticle, updateArticleFavorited, updateArticleStatus } from "@/lib/data/articles";
import { loadArticlesInCollection, loadCollectionMemberships, loadCollections } from "@/lib/data/collections";
import { searchLibrary } from "@/lib/data/search";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { useRefreshOnFocus } from "@/lib/data/use-refresh-on-focus";
import { useAuth } from "@/lib/auth/auth-provider";
import { useOnTrashed } from "@/lib/dnd/trash-drop";
import { useToast } from "@/lib/toast/toast-provider";

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
  const { status, isAuthenticated, lastSyncResult, dismissSyncResult, syncFailure, syncLocalData } = useAuth();
  const { toast } = useToast();
  const [retryingSync, setRetryingSync] = useState(false);
  const { hoarding } = useDevicePrefs();
  const searchParams = useSearchParams();
  const collectionId = searchParams.get("collection");

  const [articles, setArticles] = useState<Article[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [membership, setMembership] = useState<ArticleCollectionMemberships>({});
  const [loaded, setLoaded] = useState(false);
  // Defaults to "Unread" -- the actual queue of what's waiting to be read --
  // rather than "All" (the entire, potentially-overwhelming backlog; see the
  // "knowledge hoarding" toggle below for the same underlying concern). A
  // fresh save is always UNREAD, so it shows up here with no special-casing
  // needed on save.
  const [tab, setTab] = useState<FilterTab>("UNREAD");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchResults, setSearchResults] = useState<{ articles: Article[]; highlights: Highlight[] } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmingHoarding, setConfirmingHoarding] = useState<number | null>(null); // current unread count, while the "you sure?" prompt is up
  const [renaming, setRenaming] = useState<Article | null>(null);

  const refresh = useCallback(() => {
    if (status === "loading") return;
    Promise.all([
      collectionId ? loadArticlesInCollection(collectionId, isAuthenticated) : loadArticles(isAuthenticated),
      loadCollections(isAuthenticated),
      loadCollectionMemberships(isAuthenticated),
    ]).then(([loadedArticles, loadedCollections, loadedMembership]) => {
      setArticles(loadedArticles as Article[]);
      setCollections(loadedCollections);
      setMembership(loadedMembership);
      setLoaded(true);
    });
  }, [status, isAuthenticated, collectionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useOnTrashed(refresh); // a drag-and-drop trash drop elsewhere (app layout) doesn't touch this page's own state
  // A save through the extension or another tab/device has no way to reach
  // this page's state directly (see useRefreshOnFocus) -- catch it up the
  // moment this tab is looked at again, same as coming back and hitting
  // reload would, just without asking for that.
  useRefreshOnFocus(refresh);

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

  async function retrySync() {
    setRetryingSync(true);
    try {
      await syncLocalData();
      refresh();
    } catch {
      toast("Still couldn't move your saved articles. They're safe on this device — try again in a moment.");
    } finally {
      setRetryingSync(false);
    }
  }

  function handleSaveClick() {
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

      {/* A migration that didn't fully land has to say so. Everything counted
          here is still in this browser's IndexedDB -- but the app switches to
          reading from the server the moment you're signed in, so without this
          notice the only thing visible is an empty library, which reads as
          "signing up deleted everything" (#164). */}
      {syncFailure && syncFailure.remainingArticles > 0 && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
          <p className="font-sans text-sm text-ink">
            {syncFailure.remainingArticles} article{syncFailure.remainingArticles === 1 ? "" : "s"} saved on this
            device {syncFailure.remainingArticles === 1 ? "hasn't" : "haven't"} moved to your account yet.{" "}
            {syncFailure.remainingArticles === 1 ? "It's" : "They're"} still here and nothing has been lost.
          </p>
          <button
            type="button"
            onClick={retrySync}
            disabled={retryingSync}
            className="shrink-0 font-sans text-xs font-medium text-ink underline disabled:opacity-50"
          >
            {retryingSync ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

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
                tab === t.value ? "bg-accent text-accent-contrast shadow-sm" : "text-ink-muted hover:text-ink",
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

      <div
        className="pointer-events-none fixed bottom-4 right-4 z-30 rounded-full border border-border bg-surface/95 px-3 py-1 font-sans text-xs text-ink-faint shadow-sm backdrop-blur"
        aria-live="polite"
      >
        {visible.length} article{visible.length === 1 ? "" : "s"}
      </div>

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
