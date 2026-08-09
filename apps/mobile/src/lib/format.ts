/** "2h 14m" / "14m" / "45s" -- same formatting as the web app's
 * lib/format.ts formatDuration, copied rather than moved to shared since
 * it's the only formatter mobile needs. Rounded up front: callers can pass
 * a non-integer (Stats' avg-per-article is a plain division), and without
 * this the "Ns" fallback interpolates the raw float verbatim. */
export function formatDuration(totalSecondsInput: number): string {
  const totalSeconds = Math.round(totalSecondsInput);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}
