import type { Article, Highlight } from "@booklet/shared";

/**
 * Frontend-only fixture for building the Reader view before Auth / Save-Article
 * / highlight routes exist. Anchor offsets below were computed by actually
 * rendering `extractedHtml` and running the real computeAnchor() against the
 * resulting textContent -- not hand-counted -- so the anchoring demo is real.
 */

const PARAGRAPHS = [
  `Somewhere between reading and remembering, most of what we save gets lost. We highlight a sentence, close the tab, and trust some future version of ourselves to return for it. That version rarely shows up.`,
  `The problem isn't attention — it's that saving quietly substitutes for understanding. An article sitting in a list labeled "to read" feels like progress. It isn't. The list grows; the reading doesn't.`,
  `What actually works is smaller and less impressive: a highlight with a note next to it, written in your own words, at the moment the idea still felt alive. Not a bookmark. A trace of the thought you had.`,
  `Good annotation tools understand this distinction. They are not archives. They are conversations you have with a text, conducted in the margin, that you can return to later and still recognize as your own thinking — not just a passage you meant to get back to.`,
  `There's a reason the habit is so easy to fake. Saving costs nothing — a click, maybe two. Understanding costs something: you have to stop, decide what the sentence actually means to you, and say it in fewer words than the author used. Most save tools are built around the free action and hope the expensive one follows. It rarely does on its own.`,
  `This is why a highlight without a note is only half a thought. The color tells you it mattered. The note tells you why. Six months later, the color alone won't be enough to reconstruct what you meant — but three words in your own hand almost always will.`,
  `None of this requires more willpower. It requires the tool to ask the second question before you close the tab: not just "what did you save," but "what did you make of it." That's the whole difference between a library and a conversation.`,
];

export const MOCK_ARTICLE_HTML = PARAGRAPHS.map((p) => `<p>${p}</p>`).join("\n");

const MOCK_ARTICLE_TEXT = PARAGRAPHS.join("\n");

export const mockArticle: Article = {
  id: "mock-article-1",
  userId: "mock-user-1",
  url: "https://fieldnotes.example/the-marginal-life",
  title: "The Marginal Life",
  author: null,
  siteName: "Fieldnotes",
  excerpt: "On the difference between saving and reading.",
  sourceType: "HTML",
  extractionStatus: "SUCCESS",
  extractionError: null,
  extractedHtml: MOCK_ARTICLE_HTML,
  extractedText: MOCK_ARTICLE_TEXT,
  readingTimeEstimate: 4,
  status: "READING",
  savedAt: "2026-07-24T14:12:00.000Z",
  readAt: null,
  archivedAt: null,
  createdAt: "2026-07-24T14:12:00.000Z",
  updatedAt: "2026-07-24T14:12:00.000Z",
};

export const mockHighlights: Highlight[] = [
  {
    id: "mock-highlight-1",
    articleId: "mock-article-1",
    userId: "mock-user-1",
    selectedText: "saving quietly substitutes for understanding",
    prefix: "lem isn't attention — it's that ",
    suffix: ". An article sitting in a list l",
    startOffset: 246,
    endOffset: 290,
    color: "YELLOW",
    lastSurfacedAt: null,
    surfaceCount: 0,
    createdAt: "2026-07-24T14:20:00.000Z",
    updatedAt: "2026-07-24T14:20:00.000Z",
    annotation: null,
  },
  {
    id: "mock-highlight-2",
    articleId: "mock-article-1",
    userId: "mock-user-1",
    selectedText: "a highlight with a note next to it, written in your own words",
    prefix: "is smaller and less impressive: ",
    suffix: ", at the moment the idea still f",
    startOffset: 459,
    endOffset: 520,
    color: "BLUE",
    lastSurfacedAt: null,
    surfaceCount: 0,
    createdAt: "2026-07-24T14:23:00.000Z",
    updatedAt: "2026-07-24T14:23:00.000Z",
    annotation: {
      id: "mock-annotation-1",
      highlightId: "mock-highlight-2",
      userId: "mock-user-1",
      noteText:
        "This is the whole thesis - build the note UI around THIS moment, not the save flow.",
      createdAt: "2026-07-24T14:23:30.000Z",
      updatedAt: "2026-07-24T14:23:30.000Z",
    },
  },
  {
    id: "mock-highlight-3",
    articleId: "mock-article-1",
    userId: "mock-user-1",
    selectedText: "not just a passage you meant to get back to",
    prefix: "ecognize as your own thinking — ",
    suffix: ".\nThere's a reason the habit is ",
    startOffset: 827,
    endOffset: 870,
    color: "GREEN",
    lastSurfacedAt: null,
    surfaceCount: 0,
    createdAt: "2026-07-24T14:31:00.000Z",
    updatedAt: "2026-07-24T14:31:00.000Z",
    annotation: null,
  },
  {
    id: "mock-highlight-4",
    articleId: "mock-article-1",
    userId: "mock-user-1",
    selectedText: "a highlight without a note is only half a thought",
    prefix: "ly does on its own.\nThis is why ",
    suffix: ". The color tells you it mattere",
    startOffset: 1231,
    endOffset: 1280,
    color: "ORANGE",
    lastSurfacedAt: null,
    surfaceCount: 0,
    createdAt: "2026-07-24T14:34:00.000Z",
    updatedAt: "2026-07-24T14:34:00.000Z",
    annotation: null,
  },
];
