"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Article, Collection } from "@booklet/shared";
import { formatReadingTime, formatRelativeDate } from "@/lib/format";
import { SourceIcon } from "./source-icon";
import { StatusBadge } from "./status-badge";
import { CollectionMenu } from "./collection-menu";
import { IconArchive, IconInbox, IconTrash } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const CONFIRM_WINDOW_MS = 3000;

interface ArticleCardProps {
  article: Article;
  onToggleArchived?: (article: Article) => void;
  onDelete?: (article: Article) => void;
  collections?: Collection[];
  authenticated?: boolean;
}

export function ArticleCard({ article, onToggleArchived, onDelete, collections, authenticated }: ArticleCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const confirmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    };
  }, []);

  const metaParts = [
    article.siteName ?? article.author,
    formatReadingTime(article.readingTimeEstimate),
    `saved ${formatRelativeDate(article.savedAt)}`,
  ].filter(Boolean);

  const isArchived = article.status === "ARCHIVED";

  function handleDeleteClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      confirmTimeout.current = setTimeout(() => setConfirmingDelete(false), CONFIRM_WINDOW_MS);
      return;
    }
    if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    onDelete?.(article);
  }

  return (
    <Link
      href={`/reader/${article.id}`}
      className="group relative flex flex-col gap-3 rounded-md border border-border bg-surface px-5 py-4 transition-colors hover:border-accent/40"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-ink-faint">
          <SourceIcon sourceType={article.sourceType} className="h-4 w-4" />
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={article.status} />
          {onToggleArchived && (
            <button
              type="button"
              title={isArchived ? "Move back to library" : "Archive"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleArchived(article);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
            >
              {isArchived ? <IconInbox className="h-3.5 w-3.5" /> : <IconArchive className="h-3.5 w-3.5" />}
            </button>
          )}
          {collections && authenticated !== undefined && (
            <CollectionMenu articleId={article.id} allCollections={collections} authenticated={authenticated} />
          )}
          {onDelete && (
            <button
              type="button"
              title={confirmingDelete ? "Click again to permanently delete" : "Delete"}
              onClick={handleDeleteClick}
              onBlur={() => setConfirmingDelete(false)}
              className={cn(
                "flex h-6 items-center justify-center rounded-full px-1.5 transition-all",
                confirmingDelete
                  ? "w-auto gap-1 bg-red-500/15 text-red-500 opacity-100"
                  : "w-6 text-ink-faint opacity-0 hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              <IconTrash className="h-3.5 w-3.5 shrink-0" />
              {confirmingDelete && <span className="whitespace-nowrap font-sans text-[11px] font-medium">Confirm?</span>}
            </button>
          )}
        </div>
      </div>

      <h3 className="text-balance font-serif text-lg font-semibold leading-snug text-ink group-hover:text-accent">
        {article.title ?? "Untitled"}
      </h3>

      <p className="font-sans text-xs text-ink-faint">{metaParts.join(" · ")}</p>

      {article.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {article.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border bg-surface-2 px-2 py-0.5 font-sans text-[11px] text-ink-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {article.progressFraction > 0 && article.progressFraction < 1 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full bg-accent" style={{ width: `${Math.round(article.progressFraction * 100)}%` }} />
        </div>
      )}
    </Link>
  );
}
