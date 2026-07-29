import type { SVGProps } from "react";
import { cn } from "@/lib/cn";

/**
 * Placeholder mark -- a simple open-book glyph on a rounded badge, in the
 * app's own accent color so it themes correctly everywhere. Meant to be
 * swapped out for a real designed logo later; this just gives the wordmark
 * something to sit next to instead of nothing.
 */
export function BookletLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-6 w-6 shrink-0", className)}
      aria-hidden
      {...props}
    >
      <rect x="0.5" y="0.5" width="23" height="23" rx="6" className="fill-accent" />
      <path
        d="M12 8.2c-1.1-.9-2.6-1.3-4.2-1.3-.4 0-.7.3-.7.7v7.6c0 .4.3.7.7.7 1.6 0 3.1.4 4.2 1.3 1.1-.9 2.6-1.3 4.2-1.3.4 0 .7-.3.7-.7V7.6c0-.4-.3-.7-.7-.7-1.6 0-3.1.4-4.2 1.3Z"
        fill="none"
        className="stroke-accent-contrast"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M12 8.2v8.3" className="stroke-accent-contrast" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
