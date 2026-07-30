import type { SourceType } from "@booklet/shared";
import { IconBook, IconFileText, IconGlobe } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const ICON_BY_SOURCE: Record<SourceType, typeof IconGlobe> = {
  HTML: IconGlobe,
  PDF: IconFileText,
  EPUB: IconBook,
  // Kindle-imported book (no URL, no uploaded file) -- reuses the book
  // icon already used for EPUB, since both represent "a book," just
  // sourced differently.
  BOOK: IconBook,
};

export function SourceIcon({ sourceType, className }: { sourceType: SourceType; className?: string }) {
  const Icon = ICON_BY_SOURCE[sourceType];
  return <Icon className={cn("shrink-0", className)} />;
}
