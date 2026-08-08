"use client";

import { useEffect, useRef, useState } from "react";
import type { Collection } from "@booklet/shared";
import {
  addArticleToCollection,
  createCollection,
  loadCollectionsForArticle,
  removeArticleFromCollection,
} from "@/lib/data/collections";
import { notifyCollectionsChanged } from "@/lib/data/collections-events";
import { IconCheck, IconFolder, IconPlus } from "@/components/ui/icons";
import { useToast } from "@/lib/toast/toast-provider";
import { cn } from "@/lib/cn";

interface CollectionMenuProps {
  articleId: string;
  allCollections: Collection[];
  authenticated: boolean;
  /** Called after creating a new collection from this menu -- lets the
   * caller (article-card.tsx's parent page) add it to its own collections
   * list without a full reload, so it shows up immediately in the sidebar
   * and any other open menu too. */
  onCollectionCreated?: (collection: Collection) => void;
  /** Called right after a successful add/remove -- lets the card's badge
   * (article-card.tsx) update instantly instead of waiting on a full
   * membership refetch. */
  onMembershipChange?: (collectionId: string, isMember: boolean) => void;
}

export function CollectionMenu({
  articleId,
  allCollections: allCollectionsProp,
  authenticated,
  onCollectionCreated,
  onMembershipChange,
}: CollectionMenuProps) {
  // Smart collections have no manually-managed membership -- their
  // contents are computed from a filter, so they don't belong in an
  // "add this article to..." list.
  const allCollections = allCollectionsProp.filter((c) => !c.filter);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<Set<string> | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    loadCollectionsForArticle(articleId, authenticated)
      .then((collections) => {
        setMemberIds(new Set(collections.map((c) => c.id)));
      })
      // memberIds staying null disables every row in the menu, with no
      // spinner and no message -- a menu that looks permanently busy. Better
      // to say so and let the rows work: a toggle against a stale membership
      // set is idempotent on both the server and the local store.
      .catch(() => {
        setMemberIds(new Set());
        toast("Couldn't load this article's collections.");
      });
  }, [open, articleId, authenticated, toast]);

  function closeMenu() {
    setOpen(false);
    setCreating(false);
    setNewName("");
    setCreateError(false);
  }

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeMenu();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  async function toggle(collectionId: string) {
    if (!memberIds) return;
    setPending(collectionId);
    const isMember = memberIds.has(collectionId);
    try {
      if (isMember) {
        await removeArticleFromCollection(articleId, collectionId, authenticated);
      } else {
        await addArticleToCollection(articleId, collectionId, authenticated);
      }
      setMemberIds((prev) => {
        const next = new Set(prev);
        if (isMember) next.delete(collectionId);
        else next.add(collectionId);
        return next;
      });
      onMembershipChange?.(collectionId, !isMember);
    } catch {
      // The checkmark not moving is the only other signal, and it reads as an
      // unresponsive menu rather than a failed write.
      toast(isMember ? "Couldn't remove that from the collection." : "Couldn't add that to the collection.");
    } finally {
      setPending(null);
    }
  }

  // Creating a collection used to only be possible from the sidebar --
  // opening this menu with none yet (or wanting a new one on the spot) was
  // a dead end: "No collections yet." with no way to act on it, which is
  // exactly what made "Add to collection" look like it didn't do anything.
  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreateError(false);
    try {
      const created = await createCollection({ name }, authenticated);
      await addArticleToCollection(articleId, created.id, authenticated);
      setMemberIds((prev) => new Set(prev).add(created.id));
      onCollectionCreated?.(created);
      onMembershipChange?.(created.id, true);
      notifyCollectionsChanged(); // the sidebar owns its own separate collections list
      setCreating(false);
      setNewName("");
    } catch {
      // Name collision or similar -- keep the input open with what was typed.
      setCreateError(true);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="Add to collection"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) closeMenu();
          else setOpen(true);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
      >
        <IconFolder className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          onClick={(e) => e.preventDefault()}
          className="absolute right-0 top-7 z-10 w-52 rounded-md border border-border bg-surface p-1.5 shadow-lg"
        >
          {allCollections.length === 0 && !creating && (
            <p className="px-2 py-1.5 font-sans text-xs text-ink-faint">No collections yet.</p>
          )}
          {!creating &&
            allCollections.map((c) => {
              const isMember = memberIds?.has(c.id) ?? false;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!memberIds || pending === c.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle(c.id);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left font-sans text-sm text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  <span className="flex items-center gap-2 truncate">
                    {c.color && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color }}
                        aria-hidden
                      />
                    )}
                    <span className="truncate">{c.name}</span>
                  </span>
                  <IconCheck className={cn("h-3.5 w-3.5 shrink-0", isMember ? "text-accent" : "text-transparent")} />
                </button>
              );
            })}

          {creating ? (
            <div className="flex flex-col gap-1.5 px-1 py-1">
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setCreateError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                aria-label="New collection name"
                placeholder="Collection name"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "w-full rounded-sm border bg-paper px-2 py-1.5 font-sans text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  createError ? "border-red-400" : "border-border",
                )}
              />
              {createError && (
                <p className="px-0.5 font-sans text-xs text-red-500">Name already in use.</p>
              )}
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCreating(false);
                    setNewName("");
                    setCreateError(false);
                  }}
                  className="rounded-sm px-2 py-1 font-sans text-xs font-medium text-ink-muted hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!newName.trim()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleCreate();
                  }}
                  className="rounded-sm bg-accent px-2 py-1 font-sans text-xs font-semibold text-accent-contrast hover:bg-accent-strong disabled:opacity-50"
                >
                  Create &amp; add
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCreating(true);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-sans text-sm text-accent transition-colors hover:bg-surface-2"
            >
              <IconPlus className="h-3.5 w-3.5" />
              New collection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
