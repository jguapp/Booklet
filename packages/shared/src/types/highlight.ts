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
}

export interface UpdateHighlightRequest {
  color?: HighlightColor;
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
