"use client";

import { useEffect, useRef, useState } from "react";
import type { Collection } from "@booklet/shared";
import {
  addArticleToCollection,
  loadCollectionsForArticle,
  removeArticleFromCollection,
} from "@/lib/data/collections";
import { IconCheck, IconFolder } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

interface CollectionMenuProps {
  articleId: string;
  allCollections: Collection[];
  authenticated: boolean;
}

export function CollectionMenu({ articleId, allCollections, authenticated }: CollectionMenuProps) {
  const [open, setOpen] = useState(false);
  const [memberIds, setMemberIds] = useState<Set<string> | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    loadCollectionsForArticle(articleId, authenticated).then((collections) => {
      setMemberIds(new Set(collections.map((c) => c.id)));
    });
  }, [open, articleId, authenticated]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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
    } finally {
      setPending(null);
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
          setOpen((v) => !v);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
      >
        <IconFolder className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          onClick={(e) => e.preventDefault()}
          className="absolute right-0 top-7 z-10 w-48 rounded-md border border-border bg-surface p-1.5 shadow-lg"
        >
          {allCollections.length === 0 ? (
            <p className="px-2 py-1.5 font-sans text-xs text-ink-faint">No collections yet.</p>
          ) : (
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
            })
          )}
        </div>
      )}
    </div>
  );
}
