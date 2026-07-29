export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Deletes today" / "Deletes in N days" -- retentionDays after `sinceIso`. */
export function formatDaysRemaining(sinceIso: string, retentionDays: number, now: Date = new Date()): string {
  const purgeAt = new Date(sinceIso).getTime() + retentionDays * 24 * 60 * 60 * 1000;
  const daysLeft = Math.ceil((purgeAt - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 0) return "Deletes today";
  if (daysLeft === 1) return "Deletes tomorrow";
  return `Deletes in ${daysLeft} days`;
}

export function formatReadingTime(minutes: number | null): string {
  if (minutes === null) return "";
  if (minutes < 1) return "< 1 min read";
  return `${minutes} min read`;
}

/** Rough, dependency-free summary -- good enough to tell sessions apart, not a real UA parser. */
export function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";

  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";

  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Mac OS X/.test(userAgent)
      ? "macOS"
      : /Android/.test(userAgent)
        ? "Android"
        : /iPhone|iPad/.test(userAgent)
          ? "iOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";

  return os ? `${browser} on ${os}` : browser;
}
