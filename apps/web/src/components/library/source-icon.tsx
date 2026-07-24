import type { SourceType } from "@booklet/shared";
import { IconBook, IconFileText, IconGlobe } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const ICON_BY_SOURCE: Record<SourceType, typeof IconGlobe> = {
  HTML: IconGlobe,
  PDF: IconFileText,
  EPUB: IconBook,
};

export function SourceIcon({ sourceType, className }: { sourceType: SourceType; className?: string }) {
  const Icon = ICON_BY_SOURCE[sourceType];
  return <Icon className={cn("shrink-0", className)} />;
}
