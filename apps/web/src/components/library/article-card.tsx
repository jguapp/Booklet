"use client";

import Link from "next/link";
import type { Article, Collection } from "@booklet/shared";
import { formatReadingTime, formatRelativeDate } from "@/lib/format";
import { SourceIcon } from "./source-icon";
import { StatusBadge } from "./status-badge";
import { CollectionMenu } from "./collection-menu";
import { IconArchive, IconFolder, IconInbox, IconPencil, IconStar, IconTrash } from "@/components/ui/icons";
import { ARTICLE_DRAG_MIME } from "@/lib/dnd/trash-drop";
import { cn } from "@/lib/cn";

interface ArticleCardProps {
  article: Article;
  onToggleArchived?: (article: Article) => void;
  onToggleFavorited?: (article: Article) => void;
  onRename?: (article: Article) => void;
  onDelete?: (article: Article) => void;
  collections?: Collection[];
  authenticated?: boolean;
  onCollectionCreated?: (collection: Collection) => void;
  /** Which of `collections` this article currently belongs to -- a bulk
   * fetch (loadCollectionMemberships), not a per-card one, see whichever
   * page renders this card. Undefined (not just empty) while that fetch is
   * still in flight, so the badge row doesn't flash empty-then-populated. */
  memberCollections?: Collection[];
  onMembershipChange?: (collectionId: string, isMember: boolean) => void;
}

export function ArticleCard({
  article,
  onToggleArchived,
  onToggleFavorited,
  onRename,
  onDelete,
  collections,
  authenticated,
  onCollectionCreated,
  memberCollections,
  onMembershipChange,
}: ArticleCardProps) {
  const metaParts = [
    article.siteName ?? article.author,
    formatReadingTime(article.readingTimeEstimate),
    `saved ${formatRelativeDate(article.savedAt)}`,
  ].filter(Boolean);

  const isArchived = article.status === "ARCHIVED";

  return (
    <Link
      href={`/reader/${article.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(ARTICLE_DRAG_MIME, article.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group relative flex flex-col gap-3 rounded-md border border-border bg-surface px-5 py-4 transition-colors hover:border-accent/40"
    >
      {article.coverImageUrl && (
        // Bleeds to the card's edges (negative margins cancel the
        // container's own padding) so the thumbnail reads as a cover, not
        // an inset image -- src is always a same-origin data: URI (see
        // extraction-service.ts's fetchImageAsDataUri), never a remote
        // URL, so there's no hotlinking/referrer leak to worry about here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.coverImageUrl}
          alt=""
          className="-mx-5 -mt-4 mb-1 aspect-[16/9] w-[calc(100%+2.5rem)] max-w-none rounded-t-md object-cover"
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-ink-faint">
          <SourceIcon sourceType={article.sourceType} className="h-4 w-4" />
          <StatusBadge status={article.status} />
        </div>
        <div className="flex items-center gap-2">
          {onToggleFavorited && (
            <button
              type="button"
              title={article.favorited ? "Remove from favorites" : "Add to favorites"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleFavorited(article);
              }}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full transition-opacity",
                article.favorited
                  ? "text-accent opacity-100"
                  : "text-ink-faint opacity-0 hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              <IconStar className="h-3.5 w-3.5" fill={article.favorited ? "currentColor" : "none"} />
            </button>
          )}
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
          {onRename && (
            <button
              type="button"
              title="Rename"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRename(article);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
            >
              <IconPencil className="h-3.5 w-3.5" />
            </button>
          )}
          {collections && authenticated !== undefined && (
            <CollectionMenu
              articleId={article.id}
              allCollections={collections}
              authenticated={authenticated}
              onCollectionCreated={onCollectionCreated}
              onMembershipChange={onMembershipChange}
            />
          )}
          {onDelete && (
            <button
              type="button"
              title="Move to trash"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(article);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <h3 className="text-balance font-serif text-lg font-semibold leading-snug text-ink group-hover:text-accent">
        {article.title ?? "Untitled"}
      </h3>

      <p className="font-sans text-xs text-ink-faint">{metaParts.join(" · ")}</p>

      {memberCollections && memberCollections.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {memberCollections.map((c) => (
            <span
              key={c.id}
              title={`In collection: ${c.name}`}
              className="flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 font-sans text-[11px] text-ink-muted"
            >
              {c.color ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
              ) : (
                <IconFolder className="h-2.5 w-2.5 shrink-0" />
              )}
              {c.name}
            </span>
          ))}
        </div>
      )}

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
