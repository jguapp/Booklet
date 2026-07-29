"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { Collection } from "@booklet/shared";
import {
  IconHighlights,
  IconLibrary,
  IconLogout,
  IconPencil,
  IconPlus,
  IconResurface,
  IconRss,
  IconSettings,
  IconStar,
  IconStats,
  IconTrash,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth/auth-provider";
import { createCollection, deleteCollection, loadCollections, updateCollection } from "@/lib/data/collections";
import { trashArticleById } from "@/lib/data/articles";
import { deleteHighlight } from "@/lib/data/highlights";
import { loadShowReadingStats } from "@/lib/data/stats-prefs";
import { ApiError } from "@/lib/api/client";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ARTICLE_DRAG_MIME, HIGHLIGHT_DRAG_MIME, notifyTrashed } from "@/lib/dnd/trash-drop";

const BASE_NAV_ITEMS = [
  { href: "/library", label: "Library", Icon: IconLibrary },
  { href: "/highlights", label: "Highlights", Icon: IconHighlights },
  { href: "/favorites", label: "Favorites", Icon: IconStar },
  { href: "/rss", label: "RSS", Icon: IconRss },
  { href: "/resurface", label: "Daily Review", Icon: IconResurface },
];
const STATS_NAV_ITEM = { href: "/stats", label: "Stats", Icon: IconStats };
const TAIL_NAV_ITEMS = [
  { href: "/trash", label: "Trash", Icon: IconTrash },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // useSearchParams() forces this subtree to opt out of static prerendering
  // unless it's wrapped in Suspense -- isolated into its own component so
  // the boundary sits above it, per Next's own guidance for this error.
  return (
    <Suspense fallback={null}>
      <AppLayoutInner>{children}</AppLayoutInner>
    </Suspense>
  );
}

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { status, isAuthenticated, user, logout } = useAuth();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showStats, setShowStats] = useState(false);

  // Device-local, off by default -- see stats-prefs.ts. Read after mount,
  // same reasoning as every other device pref in this app (no localStorage
  // during SSR, so this can't be the initial state without a hydration
  // mismatch).
  useEffect(() => {
    function syncFromPrefs() {
      setShowStats(loadShowReadingStats());
    }
    syncFromPrefs();
  }, []);

  const navItems = showStats ? [...BASE_NAV_ITEMS, STATS_NAV_ITEM, ...TAIL_NAV_ITEMS] : [...BASE_NAV_ITEMS, ...TAIL_NAV_ITEMS];

  const activeCollectionId = searchParams.get("collection");

  const refreshCollections = useCallback(() => {
    if (status === "loading") return;
    loadCollections(isAuthenticated).then(setCollections);
  }, [status, isAuthenticated]);

  useEffect(() => {
    refreshCollections();
  }, [refreshCollections]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  async function handleCreateCollection(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await createCollection({ name }, isAuthenticated);
      setCollections((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setCreating(false);
      router.push(`/library?collection=${created.id}`);
    } catch (err) {
      // Name collision is the only realistic failure here -- surface it inline rather than losing the input.
      if (err instanceof ApiError) setNewName(name);
    }
  }

  function startRename(c: Collection) {
    setEditingId(c.id);
    setEditName(c.name);
  }

  async function handleRename(e: React.FormEvent, id: string) {
    e.preventDefault();
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      const updated = await updateCollection(id, { name }, isAuthenticated);
      setCollections((prev) =>
        [...prev.filter((c) => c.id !== id), updated].sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch {
      // Name collision or similar -- just keep the pre-rename name rather than losing the collection.
    }
  }

  async function handleDeleteCollection(c: Collection) {
    if (!window.confirm(`Delete "${c.name}"? Articles stay in your library, just ungrouped.`)) return;
    await deleteCollection(c.id, isAuthenticated);
    setCollections((prev) => prev.filter((col) => col.id !== c.id));
    if (activeCollectionId === c.id) router.push("/library");
  }

  // Drag-and-drop onto the Trash nav link (article-card.tsx / highlight-
  // list-item.tsx are the drag sources). An article drops straight to
  // trash, same single click as its own trash button -- it's reversible
  // for 30 days. A highlight has no trash tier (permanent delete is its
  // only "delete"), so it goes through the same real confirm its own
  // delete button already requires -- a drag gesture shouldn't skip that.
  const [dragOverTrash, setDragOverTrash] = useState(false);
  const [pendingHighlightDrop, setPendingHighlightDrop] = useState<string | null>(null);

  function handleTrashDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(ARTICLE_DRAG_MIME) || e.dataTransfer.types.includes(HIGHLIGHT_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }

  async function handleTrashDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverTrash(false);
    const articleId = e.dataTransfer.getData(ARTICLE_DRAG_MIME);
    const highlightId = e.dataTransfer.getData(HIGHLIGHT_DRAG_MIME);
    if (articleId) {
      await trashArticleById(articleId, isAuthenticated);
      notifyTrashed();
    } else if (highlightId) {
      setPendingHighlightDrop(highlightId);
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <div className="flex items-center justify-between px-5 py-6">
          <Link href="/library" className="font-serif text-xl font-semibold text-ink">
            Booklet
          </Link>
          <ThemeSwitcher />
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {navItems.map(({ href, label, Icon }) => {
            const active = (pathname === href || pathname?.startsWith(`${href}/`)) && !activeCollectionId;
            const isTrash = href === "/trash";
            return (
              <Link
                key={href}
                href={href}
                onDragOver={isTrash ? handleTrashDragOver : undefined}
                onDragEnter={isTrash ? () => setDragOverTrash(true) : undefined}
                onDragLeave={isTrash ? () => setDragOverTrash(false) : undefined}
                onDrop={isTrash ? handleTrashDrop : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-sm px-3 py-2 font-sans text-sm font-medium transition-colors",
                  active ? "bg-surface-2 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                  isTrash && dragOverTrash && "bg-red-500/15 text-red-500 ring-2 ring-red-500/40",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {label}
              </Link>
            );
          })}

          <div className="mt-6 flex items-center justify-between px-3">
            <span className="font-sans text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Collections
            </span>
            <button
              type="button"
              title="New collection"
              onClick={() => setCreating((v) => !v)}
              className="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <IconPlus className="h-3 w-3" />
            </button>
          </div>

          {creating && (
            <form onSubmit={handleCreateCollection} className="px-3 py-1">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => !newName && setCreating(false)}
                placeholder="Collection name"
                className="w-full rounded-sm border border-border bg-paper px-2 py-1 font-sans text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </form>
          )}

          {collections.map((c) =>
            editingId === c.id ? (
              <form key={c.id} onSubmit={(e) => handleRename(e, c.id)} className="px-3 py-1">
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => setEditingId(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full rounded-sm border border-border bg-paper px-2 py-1 font-sans text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </form>
            ) : (
              <Link
                key={c.id}
                href={`/library?collection=${c.id}`}
                className={cn(
                  "group flex items-center gap-2.5 rounded-sm px-3 py-1.5 font-sans text-sm transition-colors",
                  activeCollectionId === c.id
                    ? "bg-surface-2 text-accent"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: c.color ?? "var(--color-ink-faint)" }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {typeof c.articleCount === "number" && (
                  <span className="shrink-0 font-sans text-xs text-ink-faint">{c.articleCount}</span>
                )}
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    title="Rename collection"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startRename(c);
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <IconPencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    title="Delete collection"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteCollection(c);
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <IconTrash className="h-3 w-3" />
                  </button>
                </span>
              </Link>
            ),
          )}
        </nav>

        <div className="border-t border-border px-3 py-4">
          {status === "authenticated" && user ? (
            <div className="flex items-center justify-between gap-2 rounded-sm px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-sans text-sm font-medium text-ink">
                  {user.name ?? user.email}
                </div>
                <div className="truncate font-sans text-xs text-ink-faint">{user.email}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="Log out"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <IconLogout className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/signup"
              className="block rounded-sm px-3 py-2 font-sans text-xs text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Saved locally on this device.
              <span className="block font-medium text-accent">Sync across devices →</span>
            </Link>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>

      {pendingHighlightDrop && (
        <ConfirmDialog
          title="Delete this highlight?"
          message="This can't be undone."
          onCancel={() => setPendingHighlightDrop(null)}
          onConfirm={async () => {
            await deleteHighlight(pendingHighlightDrop, isAuthenticated);
            notifyTrashed();
            setPendingHighlightDrop(null);
          }}
        />
      )}
    </div>
  );
}
