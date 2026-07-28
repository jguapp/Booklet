import Link from "next/link";
import type { Article } from "@booklet/shared";
import { formatReadingTime, formatRelativeDate } from "@/lib/format";
import { SourceIcon } from "./source-icon";
import { StatusBadge } from "./status-badge";
import { IconArchive, IconInbox } from "@/components/ui/icons";

interface ArticleCardProps {
  article: Article;
  onToggleArchived?: (article: Article) => void;
}

export function ArticleCard({ article, onToggleArchived }: ArticleCardProps) {
  const metaParts = [
    article.siteName ?? article.author,
    formatReadingTime(article.readingTimeEstimate),
    `saved ${formatRelativeDate(article.savedAt)}`,
  ].filter(Boolean);

  const isArchived = article.status === "ARCHIVED";

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
        </div>
      </div>

      <h3 className="text-balance font-serif text-lg font-semibold leading-snug text-ink group-hover:text-accent">
        {article.title ?? "Untitled"}
      </h3>

      <p className="font-sans text-xs text-ink-faint">{metaParts.join(" · ")}</p>

      {article.progressFraction > 0 && article.progressFraction < 1 && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full bg-accent" style={{ width: `${Math.round(article.progressFraction * 100)}%` }} />
        </div>
      )}
    </Link>
  );
}
