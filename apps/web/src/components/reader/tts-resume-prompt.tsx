"use client";

import { useState } from "react";
import { getDeviceId } from "@/lib/reader/device-id";

/**
 * Offers to resume read-aloud from a stored listening position (#152).
 *
 * Offered, never forced -- the issue calls this half the feature, and it is.
 * Silently jumping into the middle of an article is disorienting when the
 * position came from a device the user isn't thinking about, or from a session
 * they'd already mentally abandoned. Starting from the top when they wanted to
 * continue is a smaller, more recoverable annoyance than the reverse.
 *
 * Renders nothing at all in the common case (no stored position), so the
 * ordinary reader is untouched by this.
 */

/** Below this the position rounds to "just started", and offering to resume to
 * the first few seconds is noise. Mirrors MIN_LISTENING_FRACTION in
 * tts-player-provider.tsx -- the writer and the reader of this value have to
 * agree, or a position too small to be written would still be offered. */
const MIN_RESUMABLE_FRACTION = 0.01;
/** Past this the article is effectively finished; resuming to the last few
 * seconds is worse than just starting over. */
const MAX_RESUMABLE_FRACTION = 0.98;

export interface TtsResumePromptProps {
  listeningFraction: number | null;
  listeningDeviceId: string | null;
  /** Minutes, from the article's own estimate -- used only to turn a fraction
   * into something human ("about 4 min in"). Null when unknown, in which case
   * the prompt falls back to a percentage. */
  readingTimeEstimate: number | null;
  onResume: (fraction: number) => void;
}

/** True when a stored position is worth offering. Exported for tests: this is
 * the whole decision, and it is much easier to get wrong than it looks. */
export function isResumable(listeningFraction: number | null): listeningFraction is number {
  return (
    listeningFraction !== null &&
    Number.isFinite(listeningFraction) &&
    listeningFraction >= MIN_RESUMABLE_FRACTION &&
    listeningFraction <= MAX_RESUMABLE_FRACTION
  );
}

/** "4 min in" reads as a position; "37%" reads as a statistic. Prefer the
 * former whenever there's an estimate to derive it from. */
export function describePosition(fraction: number, readingTimeEstimate: number | null): string {
  if (readingTimeEstimate && readingTimeEstimate > 0) {
    const minutes = Math.round(fraction * readingTimeEstimate);
    // Under a minute in, "0 min in" is worse than no number at all.
    if (minutes >= 1) return `about ${minutes} min in`;
  }
  return `${Math.round(fraction * 100)}% in`;
}

export function TtsResumePrompt({
  listeningFraction,
  listeningDeviceId,
  readingTimeEstimate,
  onResume,
}: TtsResumePromptProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !isResumable(listeningFraction)) return null;

  // Only claim "another device" when that's actually knowable and true. A null
  // stored id (a position written before device ids existed, or by a client
  // that couldn't persist one) is not evidence of anything, so it gets the
  // neutral wording rather than a guess.
  const fromAnotherDevice = listeningDeviceId !== null && listeningDeviceId !== getDeviceId();

  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-border bg-surface-2 px-4 py-3 font-sans text-sm"
    >
      <span className="text-ink">
        Resume listening from {describePosition(listeningFraction, readingTimeEstimate)}?
        {fromAnotherDevice ? <span className="text-ink-muted"> Last played on another device.</span> : null}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            onResume(listeningFraction);
          }}
          className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast transition-colors hover:opacity-90"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-sm px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
        >
          Start over
        </button>
      </span>
    </div>
  );
}
