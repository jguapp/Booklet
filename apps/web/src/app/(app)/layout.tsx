"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { Collection } from "@booklet/shared";
import {
  IconHighlights,
  IconLibrary,
  IconLogout,
  IconPlus,
  IconResurface,
  IconRss,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconStar,
  IconStats,
  IconTrash,
  IconUpload,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth/auth-provider";
import { createCollection, deleteCollection, loadCollections, updateCollection } from "@/lib/data/collections";
import { useOnCollectionsChanged } from "@/lib/data/collection-events";
import { loadArticles, trashArticleById } from "@/lib/data/articles";
import { deleteHighlight } from "@/lib/data/highlights";
import { CollectionTree } from "@/components/library/collection-tree";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { useDevicePrefs } from "@/lib/data/device-prefs-provider";
import { applyNavOrder } from "@/lib/data/nav-order-prefs";
import { ApiError } from "@/lib/api/client";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { BookletLogo } from "@/components/ui/logo";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ARTICLE_DRAG_MIME, HIGHLIGHT_DRAG_MIME, notifyTrashed } from "@/lib/dnd/trash-drop";

const NAV_DRAG_MIME = "application/x-booklet-nav-href";

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
  { href: "/import-export", label: "Import & Export", Icon: IconUpload },
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { showReadingStats, autoDelete, navOrder, setNavOrder, sidebarCompact, setSidebarCompact } = useDevicePrefs();
  const [sidebarHovered, setSidebarHovered] = useState(false);
  // In compact mode the rail itself stays narrow (so the layout never
  // reflows) and an overlay pops out on hover -- content is only "full" when
  // not compact, or compact-but-hovered.
  const sidebarExpanded = !sidebarCompact || sidebarHovered;

  const navItems = applyNavOrder(
    showReadingStats ? [...BASE_NAV_ITEMS, STATS_NAV_ITEM, ...TAIL_NAV_ITEMS] : [...BASE_NAV_ITEMS, ...TAIL_NAV_ITEMS],
    navOrder,
  );

  // Auto-delete stale unread articles (trash, not permanent -- still
  // recoverable for 30 days like every other delete path) -- runs once per
  // app session here rather than on a specific page, since it should apply
  // regardless of where the user lands first. See auto-delete-prefs.ts.
  useEffect(() => {
    if (status === "loading" || !autoDelete.enabled) return;
    async function purgeStaleUnread() {
      const cutoff = Date.now() - autoDelete.days * 24 * 60 * 60 * 1000;
      const articles = await loadArticles(isAuthenticated);
      const stale = articles.filter((a) => a.status === "UNREAD" && new Date(a.savedAt).getTime() < cutoff);
      if (stale.length === 0) return;
      await Promise.all(stale.map((a) => trashArticleById(a.id, isAuthenticated)));
      notifyTrashed();
    }
    purgeStaleUnread().catch(() => undefined);
  }, [status, isAuthenticated, autoDelete.enabled, autoDelete.days]);

  const activeCollectionId = searchParams.get("collection");

  const refreshCollections = useCallback(() => {
    if (status === "loading") return;
    loadCollections(isAuthenticated).then(setCollections);
  }, [status, isAuthenticated]);

  useEffect(() => {
    refreshCollections();
  }, [refreshCollections]);
  useOnCollectionsChanged(refreshCollections);

  // Cmd+K (Mac) / Ctrl+K (everywhere else) -- global regardless of which
  // page is mounted, since the whole point is not needing to already be on
  // the right page. preventDefault stops the browser's own "focus address
  // bar" binding for Ctrl/Cmd+K in some browsers from firing alongside it.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function handleReparentCollection(draggedId: string, targetId: string | null) {
    try {
      const updated = await updateCollection(draggedId, { parentId: targetId }, isAuthenticated);
      setCollections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      // Cycle/not-found -- surfaced via the collection just not moving; the
      // drag interaction itself has no error-message affordance to use.
    }
  }

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
  //
  // The nav items themselves are *also* draggable, to reorder the sidebar
  // (persisted via navOrder above) -- so every nav link, Trash included, is
  // a drop target for two different kinds of payload at once. Dispatch on
  // e.dataTransfer.types rather than having two separate handlers stepping
  // on each other.
  const [dragOverTrash, setDragOverTrash] = useState(false);
  const [dragOverHref, setDragOverHref] = useState<string | null>(null);
  const [pendingHighlightDrop, setPendingHighlightDrop] = useState<string | null>(null);

  function handleNavDragOver(e: React.DragEvent, isTrash: boolean) {
    const types = e.dataTransfer.types;
    const isTrashPayload = isTrash && (types.includes(ARTICLE_DRAG_MIME) || types.includes(HIGHLIGHT_DRAG_MIME));
    if (isTrashPayload || types.includes(NAV_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }

  async function handleNavDrop(e: React.DragEvent, targetHref: string, isTrash: boolean) {
    e.preventDefault();
    setDragOverTrash(false);
    setDragOverHref(null);

    if (isTrash && (e.dataTransfer.types.includes(ARTICLE_DRAG_MIME) || e.dataTransfer.types.includes(HIGHLIGHT_DRAG_MIME))) {
      const articleId = e.dataTransfer.getData(ARTICLE_DRAG_MIME);
      const highlightId = e.dataTransfer.getData(HIGHLIGHT_DRAG_MIME);
      if (articleId) {
        await trashArticleById(articleId, isAuthenticated);
        notifyTrashed();
      } else if (highlightId) {
        setPendingHighlightDrop(highlightId);
      }
      return;
    }

    const draggedHref = e.dataTransfer.getData(NAV_DRAG_MIME);
    if (!draggedHref || draggedHref === targetHref) return;
    const currentOrder = navItems.map((item) => item.href);
    const from = currentOrder.indexOf(draggedHref);
    const to = currentOrder.indexOf(targetHref);
    if (from === -1 || to === -1) return;
    const reordered = [...currentOrder];
    reordered.splice(from, 1);
    reordered.splice(to, 0, draggedHref);
    setNavOrder(reordered);
  }

  return (
    <div className="flex min-h-screen">
      <aside className={cn("relative shrink-0", sidebarCompact ? "w-14" : "w-60 border-r border-border")}>
        <div
          onMouseEnter={() => sidebarCompact && setSidebarHovered(true)}
          onMouseLeave={() => sidebarCompact && setSidebarHovered(false)}
          className={cn(
            "flex h-full flex-col bg-surface",
            sidebarCompact
              ? cn(
                  "absolute inset-y-0 left-0 z-30 overflow-hidden border-r border-border transition-[width] duration-150",
                  sidebarExpanded ? "w-60 shadow-xl" : "w-14",
                )
              : "w-60",
          )}
        >
          <div className={cn("flex items-center gap-2 py-6", sidebarExpanded ? "px-5" : "justify-center px-2")}>
            <BookletLogo className="mt-1.5 shrink-0" />
            {sidebarExpanded && (
              <Link href="/library" className="whitespace-nowrap font-serif text-xl font-semibold text-ink">
                Booklet
              </Link>
            )}
            {sidebarExpanded && (
              <button
                type="button"
                title={sidebarCompact ? "Keep the sidebar open" : "Auto-hide the sidebar on hover"}
                onClick={() => setSidebarCompact(!sidebarCompact)}
                className={cn(
                  "ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-2 hover:text-ink",
                  sidebarCompact ? "text-accent" : "text-ink-faint",
                )}
              >
                <IconSidebar className="h-4 w-4" />
              </button>
            )}
          </div>

          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-3">
            <button
              type="button"
              title={sidebarExpanded ? undefined : "Search (Ctrl/Cmd+K)"}
              onClick={() => setPaletteOpen(true)}
              className={cn(
                "flex items-center gap-2.5 rounded-sm px-3 py-2 font-sans text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink",
                !sidebarExpanded && "justify-center px-0",
              )}
            >
              <IconSearch className="h-[18px] w-[18px] shrink-0" />
              {sidebarExpanded && (
                <>
                  <span className="flex-1 text-left">Search</span>
                  <span className="shrink-0 rounded border border-border px-1 py-0.5 font-sans text-[10px] text-ink-faint">
                    ⌘K
                  </span>
                </>
              )}
            </button>

            {navItems.map(({ href, label, Icon }) => {
              const active = (pathname === href || pathname?.startsWith(`${href}/`)) && !activeCollectionId;
              const isTrash = href === "/trash";
              return (
                <Link
                  key={href}
                  href={href}
                  title={sidebarExpanded ? undefined : label}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(NAV_DRAG_MIME, href);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => handleNavDragOver(e, isTrash)}
                  onDragEnter={() => {
                    if (isTrash) setDragOverTrash(true);
                    setDragOverHref(href);
                  }}
                  onDragLeave={() => {
                    if (isTrash) setDragOverTrash(false);
                    setDragOverHref((prev) => (prev === href ? null : prev));
                  }}
                  onDrop={(e) => handleNavDrop(e, href, isTrash)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-sm px-3 py-2 font-sans text-sm font-medium transition-colors",
                    !sidebarExpanded && "justify-center px-0",
                    active ? "bg-surface-2 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                    isTrash && dragOverTrash
                      ? "bg-red-500/15 text-red-500 ring-2 ring-red-500/40"
                      : dragOverHref === href && "ring-2 ring-accent/40",
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {sidebarExpanded && <span className="truncate">{label}</span>}
                </Link>
              );
            })}

            {sidebarExpanded && (
              <>
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

                <CollectionTree
                  collections={collections}
                  activeCollectionId={activeCollectionId}
                  editingId={editingId}
                  editName={editName}
                  onEditNameChange={setEditName}
                  onStartRename={startRename}
                  onRename={handleRename}
                  onCancelRename={() => setEditingId(null)}
                  onDelete={handleDeleteCollection}
                  onReparent={handleReparentCollection}
                />
              </>
            )}
          </nav>

          {sidebarExpanded && (
            <>
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

              <div className="flex justify-center border-t border-border px-5 py-3">
                <ThemeSwitcher />
              </div>
            </>
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

      {paletteOpen && (
        <CommandPalette navItems={navItems} collections={collections} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}
