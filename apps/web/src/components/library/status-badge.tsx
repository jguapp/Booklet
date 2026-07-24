import type { ArticleStatus } from "@booklet/shared";
import { cn } from "@/lib/cn";

const LABEL: Record<ArticleStatus, string> = {
  UNREAD: "Unread",
  READING: "Reading",
  ARCHIVED: "Archived",
};

const CLASS: Record<ArticleStatus, string> = {
  UNREAD: "text-ink-muted",
  READING: "text-accent",
  ARCHIVED: "text-ink-faint",
};

export function StatusBadge({ status }: { status: ArticleStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 font-sans text-[11px] font-semibold uppercase tracking-wide",
        CLASS[status],
      )}
    >
      {LABEL[status]}
    </span>
  );
}
