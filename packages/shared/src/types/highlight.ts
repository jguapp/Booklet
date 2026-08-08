import type { Annotation } from "./annotation";
import type { HighlightPosition } from "./highlight-position";

/** A legacy name ("YELLOW", "GREEN", "BLUE", "PINK", "ORANGE") or a literal
 * `#RRGGBB` hex value -- see highlight-colors.ts for validation/rendering
 * helpers and why this isn't a fixed union anymore. */
export type HighlightColor = string;
export type ResurfaceFeedback = "REMEMBERED" | "FORGOT";

export interface Highlight {
  id: string;
  articleId: string;
  userId: string;

  selectedText: string;
  position: HighlightPosition;

  color: HighlightColor;

  /** Optional question whose answer is this highlight, turning resurfacing
   * into a retrieval attempt instead of a re-read -- see recall-prompt.ts.
   * null (the default, and what every highlight saved before #157 has) keeps
   * the original show-then-grade behavior. */
  prompt: string | null;

  lastSurfacedAt: string | null;
  surfaceCount: number;

  lastFeedback: ResurfaceFeedback | null;
  lastFeedbackAt: string | null;
  resurfaceArchivedAt: string | null;

  /** SM-2 spaced-repetition state -- see packages/shared/resurface.ts. */
  easinessFactor: number;
  intervalDays: number;
  repetitions: number;
  nextDueAt: string | null;

  createdAt: string;
  updatedAt: string;

  annotation?: Annotation | null;
}

export interface CreateHighlightRequest {
  articleId: string;
  selectedText: string;
  position: HighlightPosition;
  color: HighlightColor;
  /** Optional -- creates the highlight and its note in one round trip. */
  noteText?: string;
  /** Optional recall prompt, same round trip. Whitespace-only is stored as
   * null (see normalizeRecallPrompt). */
  prompt?: string | null;
}

export interface UpdateHighlightRequest {
  color?: HighlightColor;
  /** null clears the prompt; omitted leaves it untouched. */
  prompt?: string | null;
  resurfaceArchivedAt?: string | null;
  lastSurfacedAt?: string;
  surfaceCount?: number;
  lastFeedback?: ResurfaceFeedback;
  lastFeedbackAt?: string;
  easinessFactor?: number;
  intervalDays?: number;
  repetitions?: number;
  nextDueAt?: string;
}
