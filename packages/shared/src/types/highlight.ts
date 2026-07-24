import type { Annotation } from "./annotation";
import type { HighlightPosition } from "./highlight-position";

export type HighlightColor = "YELLOW" | "GREEN" | "BLUE" | "PINK" | "ORANGE";
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

  createdAt: string;
  updatedAt: string;

  annotation?: Annotation | null;
}
