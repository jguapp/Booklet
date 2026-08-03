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

/** "2h 14m" / "14m" / "45s" -- shared by Stats and Recap, both of which
 * show accumulated activeReadingSeconds. Rounded up front: callers can
 * pass a non-integer (e.g. Stats' avg-per-article is a plain division),
 * and without this the "Ns" fallback below interpolates the raw float
 * verbatim -- "25.333333333333332s" instead of "25s". */
export function formatDuration(totalSecondsInput: number): string {
  const totalSeconds = Math.round(totalSecondsInput);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

/** "45 min" / "11h 56m" / "3h" -- long estimates (a whole book, easily
 * hundreds of minutes) read as a raw minute count otherwise ("716 min"
 * read), which nobody scans at a glance the way "11h 56m" does. */
function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function formatReadingTime(minutes: number | null): string {
  if (minutes === null) return "";
  if (minutes < 1) return "< 1 min read";
  return `${formatMinutes(minutes)} read`;
}

/** Same hour/minute formatting as formatReadingTime, for the "N left"
 * remaining-time phrasing (reader-view.tsx's byline, the persistent
 * progress bar) instead of the "N read" total-estimate phrasing. */
export function formatMinutesLeft(minutes: number): string {
  if (minutes < 1) return "< 1 min left";
  return `${formatMinutes(minutes)} left`;
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
