import type { Article, Highlight } from "@booklet/shared";

/**
 * Static seed data for the whole app -- every page reads from the mock
 * store (lib/mock/store.ts), which starts from this seed and persists
 * changes to localStorage. There's no backend yet (see the frontend-only
 * decisions made throughout this project), so this stands in for what
 * would otherwise come from GET /api/articles etc.
 */

export const mockUser = {
  id: "mock-user-1",
  name: "Reader",
  email: "reader@example.com",
  resurfaceFrequency: "DAILY" as const,
  highlightsPerDigest: 5,
};

// ---------- Article 1: "The Marginal Life" (HTML, reading) ----------
// Kept byte-for-byte identical to the original Reader view demo content --
// its id and highlight offsets are what a browser's existing
// booklet-mock-highlights-v2 localStorage entry already points at.

const MARGINAL_LIFE_PARAGRAPHS = [
  `Somewhere between reading and remembering, most of what we save gets lost. We highlight a sentence, close the tab, and trust some future version of ourselves to return for it. That version rarely shows up.`,
  `The problem isn't attention — it's that saving quietly substitutes for understanding. An article sitting in a list labeled "to read" feels like progress. It isn't. The list grows; the reading doesn't.`,
  `What actually works is smaller and less impressive: a highlight with a note next to it, written in your own words, at the moment the idea still felt alive. Not a bookmark. A trace of the thought you had.`,
  `Good annotation tools understand this distinction. They are not archives. They are conversations you have with a text, conducted in the margin, that you can return to later and still recognize as your own thinking — not just a passage you meant to get back to.`,
  `There's a reason the habit is so easy to fake. Saving costs nothing — a click, maybe two. Understanding costs something: you have to stop, decide what the sentence actually means to you, and say it in fewer words than the author used. Most save tools are built around the free action and hope the expensive one follows. It rarely does on its own.`,
  `This is why a highlight without a note is only half a thought. The color tells you it mattered. The note tells you why. Six months later, the color alone won't be enough to reconstruct what you meant — but three words in your own hand almost always will.`,
  `None of this requires more willpower. It requires the tool to ask the second question before you close the tab: not just "what did you save," but "what did you make of it." That's the whole difference between a library and a conversation.`,
];

export const MARGINAL_LIFE_HTML = MARGINAL_LIFE_PARAGRAPHS.map((p) => `<p>${p}</p>`).join("\n");
const MARGINAL_LIFE_TEXT = MARGINAL_LIFE_PARAGRAPHS.join("\n");

// ---------- Article 2: "The Cost of Almost Reading" (HTML, unread) ----------

const ALMOST_READING_PARAGRAPHS = [
  `Open tabs are a kind of debt. Each one is a small promise — I will read this — made to a version of yourself that mostly doesn't show up to collect.`,
  `The tab isn't costless just because it's unread. It sits in your peripheral vision, a low hum of unfinished business, and the accumulation of enough of them starts to feel like failure even though nothing was ever due.`,
  `Closing a tab you'll never read is not giving up. It's admitting the truth a well-kept list would have told you months ago.`,
];
const ALMOST_READING_HTML = ALMOST_READING_PARAGRAPHS.map((p) => `<p>${p}</p>`).join("\n");
const ALMOST_READING_TEXT = ALMOST_READING_PARAGRAPHS.join("\n");

// ---------- Article 3: "Notes on Forgetting" (HTML, archived) ----------

const FORGETTING_PARAGRAPHS = [
  `Forgetting is usually described as a failure of memory, but most of what we forget was never going to be useful again, and the mind seems to know this before we do.`,
  `What's worth keeping isn't the fact but the shape of the thought you had about it — which is exactly the part a highlight with no note fails to preserve.`,
  `The measure of a note isn't whether you remember the sentence. It's whether, months later, you still recognize the thought as yours.`,
];
const FORGETTING_HTML = FORGETTING_PARAGRAPHS.map((p) => `<p>${p}</p>`).join("\n");
const FORGETTING_TEXT = FORGETTING_PARAGRAPHS.join("\n");

// ---------- Article 4: PDF upload, no rendered body (PDF.js integration is a follow-up phase) ----------

const ATTENTION_PDF_TEXT = `This paper considers attention not as a resource to be allocated but as a will extended into artifacts — the highlight, the marginal note, the dog-eared page — each a small act of committing a self to a claim about what mattered.`;

// ---------- Article 5: EPUB upload, no rendered body (epub.js integration is a follow-up phase) ----------

const MARGINALIA_EPUB_TEXT = `Long before software, readers argued with their books in ink. The habit we're trying to rebuild is older than any app that promises to fix it.`;

export const seedArticles: Article[] = [
  {
    id: "mock-article-1",
    userId: mockUser.id,
    url: "https://fieldnotes.example/the-marginal-life",
    title: "The Marginal Life",
    author: null,
    siteName: "Fieldnotes",
    excerpt: "On the difference between saving and reading.",
    sourceType: "HTML",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: MARGINAL_LIFE_HTML,
    extractedText: MARGINAL_LIFE_TEXT,
    fileStorageKey: null,
    originalFilename: null,
    readingTimeEstimate: 4,
    progressFraction: 0.4,
    status: "READING",
    savedAt: "2026-07-24T14:12:00.000Z",
    readAt: null,
    archivedAt: null,
    createdAt: "2026-07-24T14:12:00.000Z",
    updatedAt: "2026-07-24T14:12:00.000Z",
  },
  {
    id: "mock-article-2",
    userId: mockUser.id,
    url: "https://slowwire.example/cost-of-almost-reading",
    title: "The Cost of Almost Reading",
    author: null,
    siteName: "Slow Wire",
    excerpt: "Every open tab is a small, mostly unpaid debt.",
    sourceType: "HTML",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: ALMOST_READING_HTML,
    extractedText: ALMOST_READING_TEXT,
    fileStorageKey: null,
    originalFilename: null,
    readingTimeEstimate: 1,
    progressFraction: 0,
    status: "UNREAD",
    savedAt: "2026-07-22T09:03:00.000Z",
    readAt: null,
    archivedAt: null,
    createdAt: "2026-07-22T09:03:00.000Z",
    updatedAt: "2026-07-22T09:03:00.000Z",
  },
  {
    id: "mock-article-3",
    userId: mockUser.id,
    url: "https://fieldnotes.example/notes-on-forgetting",
    title: "Notes on Forgetting",
    author: null,
    siteName: "Fieldnotes",
    excerpt: "What's worth keeping is the shape of the thought, not the fact.",
    sourceType: "HTML",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: FORGETTING_HTML,
    extractedText: FORGETTING_TEXT,
    fileStorageKey: null,
    originalFilename: null,
    readingTimeEstimate: 1,
    progressFraction: 1,
    status: "ARCHIVED",
    savedAt: "2026-06-30T18:45:00.000Z",
    readAt: "2026-06-30T19:01:00.000Z",
    archivedAt: "2026-06-30T19:02:00.000Z",
    createdAt: "2026-06-30T18:45:00.000Z",
    updatedAt: "2026-06-30T19:02:00.000Z",
  },
  {
    id: "mock-article-4",
    userId: mockUser.id,
    url: null,
    title: "Attention and the Extended Will",
    author: "R. Voss",
    siteName: null,
    excerpt: "A paper on attention as a will extended into artifacts.",
    sourceType: "PDF",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: null,
    extractedText: ATTENTION_PDF_TEXT,
    fileStorageKey: "uploads/mock-user-1/attention-and-extended-will.pdf",
    originalFilename: "attention-and-extended-will.pdf",
    readingTimeEstimate: 12,
    progressFraction: 0,
    status: "UNREAD",
    savedAt: "2026-07-20T11:30:00.000Z",
    readAt: null,
    archivedAt: null,
    createdAt: "2026-07-20T11:30:00.000Z",
    updatedAt: "2026-07-20T11:30:00.000Z",
  },
  {
    id: "mock-article-5",
    userId: mockUser.id,
    url: null,
    title: "A Short History of Marginalia",
    author: "E. Solano",
    siteName: null,
    excerpt: "Readers have been arguing with their books since long before software.",
    sourceType: "EPUB",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: null,
    extractedText: MARGINALIA_EPUB_TEXT,
    fileStorageKey: "uploads/mock-user-1/short-history-of-marginalia.epub",
    originalFilename: "short-history-of-marginalia.epub",
    readingTimeEstimate: 45,
    progressFraction: 0.15,
    status: "READING",
    savedAt: "2026-07-10T20:15:00.000Z",
    readAt: null,
    archivedAt: null,
    createdAt: "2026-07-10T20:15:00.000Z",
    updatedAt: "2026-07-10T20:15:00.000Z",
  },
];

export const seedHighlights: Highlight[] = [
  {
    id: "mock-highlight-1",
    articleId: "mock-article-1",
    userId: mockUser.id,
    selectedText: "saving quietly substitutes for understanding",
    position: {
      type: "text",
      exact: "saving quietly substitutes for understanding",
      prefix: "lem isn't attention — it's that ",
      suffix: ". An article sitting in a list l",
      start: 246,
      end: 290,
    },
    color: "YELLOW",
    lastSurfacedAt: null,
    surfaceCount: 0,
    lastFeedback: null,
    lastFeedbackAt: null,
    resurfaceArchivedAt: null,
    createdAt: "2026-07-24T14:20:00.000Z",
    updatedAt: "2026-07-24T14:20:00.000Z",
    annotation: null,
  },
  {
    id: "mock-highlight-2",
    articleId: "mock-article-1",
    userId: mockUser.id,
    selectedText: "a highlight with a note next to it, written in your own words",
    position: {
      type: "text",
      exact: "a highlight with a note next to it, written in your own words",
      prefix: "is smaller and less impressive: ",
      suffix: ", at the moment the idea still f",
      start: 459,
      end: 520,
    },
    color: "BLUE",
    lastSurfacedAt: "2026-07-20T08:00:00.000Z",
    surfaceCount: 2,
    lastFeedback: "REMEMBERED",
    lastFeedbackAt: "2026-07-20T08:05:00.000Z",
    resurfaceArchivedAt: null,
    createdAt: "2026-07-24T14:23:00.000Z",
    updatedAt: "2026-07-20T08:05:00.000Z",
    annotation: {
      id: "mock-annotation-1",
      highlightId: "mock-highlight-2",
      userId: mockUser.id,
      noteText:
        "This is the whole thesis - build the note UI around THIS moment, not the save flow.",
      createdAt: "2026-07-24T14:23:30.000Z",
      updatedAt: "2026-07-24T14:23:30.000Z",
    },
  },
  {
    id: "mock-highlight-3",
    articleId: "mock-article-1",
    userId: mockUser.id,
    selectedText: "not just a passage you meant to get back to",
    position: {
      type: "text",
      exact: "not just a passage you meant to get back to",
      prefix: "ecognize as your own thinking — ",
      suffix: ".\nThere's a reason the habit is ",
      start: 827,
      end: 870,
    },
    color: "GREEN",
    lastSurfacedAt: null,
    surfaceCount: 0,
    lastFeedback: null,
    lastFeedbackAt: null,
    resurfaceArchivedAt: null,
    createdAt: "2026-07-24T14:31:00.000Z",
    updatedAt: "2026-07-24T14:31:00.000Z",
    annotation: null,
  },
  {
    id: "mock-highlight-4",
    articleId: "mock-article-1",
    userId: mockUser.id,
    selectedText: "a highlight without a note is only half a thought",
    position: {
      type: "text",
      exact: "a highlight without a note is only half a thought",
      prefix: "ly does on its own.\nThis is why ",
      suffix: ". The color tells you it mattere",
      start: 1231,
      end: 1280,
    },
    color: "ORANGE",
    lastSurfacedAt: "2026-07-15T08:00:00.000Z",
    surfaceCount: 1,
    lastFeedback: "FORGOT",
    lastFeedbackAt: "2026-07-15T08:04:00.000Z",
    resurfaceArchivedAt: null,
    createdAt: "2026-07-24T14:34:00.000Z",
    updatedAt: "2026-07-15T08:04:00.000Z",
    annotation: null,
  },
  {
    id: "mock-highlight-5",
    articleId: "mock-article-3",
    userId: mockUser.id,
    selectedText: "the shape of the thought you had about it",
    position: {
      type: "text",
      exact: "the shape of the thought you had about it",
      prefix: "What's worth keeping isn't the fact but ",
      suffix: " — which is exactly the part a ",
      start: 41,
      end: 83,
    },
    color: "PINK",
    lastSurfacedAt: null,
    surfaceCount: 0,
    lastFeedback: null,
    lastFeedbackAt: null,
    resurfaceArchivedAt: null,
    createdAt: "2026-06-30T19:00:00.000Z",
    updatedAt: "2026-06-30T19:00:00.000Z",
    annotation: {
      id: "mock-annotation-2",
      highlightId: "mock-highlight-5",
      userId: mockUser.id,
      noteText: "The shape, not the fact. Keep coming back to this one.",
      createdAt: "2026-06-30T19:00:30.000Z",
      updatedAt: "2026-06-30T19:00:30.000Z",
    },
  },
  {
    id: "mock-highlight-6",
    articleId: "mock-article-4",
    userId: mockUser.id,
    selectedText: "attention not as a resource to be allocated but as a will extended into artifacts",
    position: {
      type: "pdf",
      pageNumber: 4,
      text: "attention not as a resource to be allocated but as a will extended into artifacts",
      prefix: "This paper considers ",
      suffix: " — the highlight, the marginal",
      rects: [{ x: 72, y: 480, width: 340, height: 14 }],
    },
    color: "BLUE",
    lastSurfacedAt: null,
    surfaceCount: 0,
    lastFeedback: null,
    lastFeedbackAt: null,
    resurfaceArchivedAt: null,
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
    annotation: null,
  },
  {
    id: "mock-highlight-7",
    articleId: "mock-article-5",
    userId: mockUser.id,
    selectedText: "readers argued with their books in ink",
    position: {
      type: "epub",
      cfi: "epubcfi(/6/8!/4/2/2/1:0,/4/2/2/1:39)",
    },
    color: "YELLOW",
    lastSurfacedAt: null,
    surfaceCount: 0,
    lastFeedback: null,
    lastFeedbackAt: null,
    resurfaceArchivedAt: null,
    createdAt: "2026-07-11T09:00:00.000Z",
    updatedAt: "2026-07-11T09:00:00.000Z",
    annotation: null,
  },
];
