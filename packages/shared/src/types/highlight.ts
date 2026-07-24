import type { Annotation } from "./annotation";

export type HighlightColor = "YELLOW" | "GREEN" | "BLUE" | "PINK" | "ORANGE";

/** W3C Web Annotation TextQuoteSelector -- content-based, survives offset drift. */
export interface TextQuoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

/** W3C Web Annotation TextPositionSelector -- fast path, refined by the quote above. */
export interface TextPositionAnchor {
  start: number;
  end: number;
}

export interface Highlight {
  id: string;
  articleId: string;
  userId: string;

  selectedText: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;

  color: HighlightColor;

  lastSurfacedAt: string | null;
  surfaceCount: number;

  createdAt: string;
  updatedAt: string;

  annotation?: Annotation | null;
}
