"use client";

import { useState } from "react";
import Link from "next/link";
import type { Collection } from "@booklet/shared";
import { IconPencil, IconSearch, IconTrash } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

/** Drag MIME for re-parenting a collection onto another -- distinct from
 * NAV_DRAG_MIME (sidebar nav reorder) and ARTICLE/HIGHLIGHT_DRAG_MIME
 * (drop-to-trash), same "different types, dispatch on e.dataTransfer.types"
 * posture as those already established in the app shell. */
export const COLLECTION_DRAG_MIME = "application/x-booklet-collection-id";

interface CollectionTreeProps {
  collections: Collection[];
  activeCollectionId: string | null;
  editingId: string | null;
  editName: string;
  onEditNameChange: (name: string) => void;
  onStartRename: (c: Collection) => void;
  onRename: (e: React.FormEvent, id: string) => void;
  onCancelRename: () => void;
  onDelete: (c: Collection) => void;
  onReparent: (draggedId: string, targetId: string | null) => void;
}

function buildTree(collections: Collection[], parentId: string | null): Collection[] {
  return collections.filter((c) => c.parentId === parentId);
}

export function CollectionTree(props: CollectionTreeProps) {
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const topLevel = buildTree(props.collections, null);

  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(COLLECTION_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData(COLLECTION_DRAG_MIME);
    if (!draggedId || draggedId === targetId) return;
    props.onReparent(draggedId, targetId);
  }

  function renderRow(c: Collection, depth: number): React.ReactNode {
    const children = buildTree(props.collections, c.id);
    const isSmart = !!c.filter;

    if (props.editingId === c.id) {
      return (
        <form
          key={c.id}
          onSubmit={(e) => props.onRename(e, c.id)}
          className="px-3 py-1"
          style={{ paddingLeft: 12 + depth * 14 }}
        >
          <input
            autoFocus
            value={props.editName}
            onChange={(e) => props.onEditNameChange(e.target.value)}
            onBlur={props.onCancelRename}
            onKeyDown={(e) => {
              if (e.key === "Escape") props.onCancelRename();
            }}
            className="w-full rounded-sm border border-border bg-paper px-2 py-1 font-sans text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </form>
      );
    }

    return (
      <div key={c.id}>
        <Link
          href={`/library?collection=${c.id}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(COLLECTION_DRAG_MIME, c.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={handleDragOver}
          onDragEnter={() => setDragOverId(c.id)}
          onDragLeave={() => setDragOverId((prev) => (prev === c.id ? null : prev))}
          onDrop={(e) => handleDrop(e, c.id)}
          style={{ paddingLeft: 12 + depth * 14 }}
          title={isSmart ? "Smart collection -- contents match its saved search" : undefined}
          className={cn(
            "group flex items-center gap-2.5 rounded-sm py-1.5 pr-3 font-sans text-sm transition-colors",
            props.activeCollectionId === c.id ? "bg-surface-2 text-accent" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
            dragOverId === c.id && "ring-2 ring-accent/40",
          )}
        >
          {isSmart ? (
            <IconSearch className="h-3 w-3 shrink-0 text-ink-faint" />
          ) : (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: c.color ?? "var(--color-ink-faint)" }}
              aria-hidden
            />
          )}
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
                props.onStartRename(c);
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
                props.onDelete(c);
              }}
              className="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-surface hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
            >
              <IconTrash className="h-3 w-3" />
            </button>
          </span>
        </Link>
        {children.map((child) => renderRow(child, depth + 1))}
      </div>
    );
  }

  return <>{topLevel.map((c) => renderRow(c, 0))}</>;
}
