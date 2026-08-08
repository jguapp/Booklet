import { act, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@booklet/shared";
import { cleanup, render } from "@/test/render";

/**
 * What happens when the reader is handed a *second* article.
 *
 * In-app navigation between two reader pages (the "More from your library"
 * links, the command palette, a Notebook jump) reuses this same component
 * instance rather than remounting it, so anything per-article that lives in a
 * ref or in state and isn't derived from `article` describes the article the
 * reader just left. Two of those were being missed, and neither is visible in
 * a screenshot: the second article silently ignored its saved reading
 * position, and -- because `progress` still held the finished article's value
 * -- it could be auto-archived on arrival without being read.
 *
 * Both need the whole component, not a helper, because both are about the
 * interaction between a prop change and effects that don't depend on it.
 */

const now = "2026-01-01T00:00:00.000Z";
function article(id: string, progressFraction: number, status: Article["status"]): Article {
  return {
    id,
    userId: "local",
    url: null,
    canonicalUrl: null,
    title: `Article ${id}`,
    author: null,
    siteName: null,
    excerpt: null,
    sourceType: "HTML",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: "<p>Body text.</p>",
    extractedText: "Body text.",
    textSource: null,
    fileStorageKey: null,
    originalFilename: null,
    coverImageUrl: null,
    readingTimeEstimate: 5,
    skippedImageCount: 0,
    progressFraction,
    activeReadingSeconds: 0,
    listeningFraction: null,
    listeningUpdatedAt: null,
    listeningDeviceId: null,
    tags: [],
    status,
    savedAt: now,
    readAt: null,
    archivedAt: null,
    favorited: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

const articles = new Map<string, Article>();
const loadArticle = vi.fn(async (id: string) => articles.get(id) ?? null);
const updateArticleStatus = vi.fn(async (a: Article, status: Article["status"]) => ({ ...a, status }));
const loadArticleFile = vi.fn(async () => null);

vi.mock("@/lib/data/articles", () => ({
  ApiError: class ApiError extends Error {},
  loadArticle: (id: string) => loadArticle(id),
  loadArticles: async () => [],
  loadArticleFile: () => loadArticleFile(),
  renameArticle: async (a: Article, title: string) => ({ ...a, title }),
  sendArticleToKindle: async () => undefined,
  updateArticleProgress: async (a: Article) => a,
  updateArticleStatus: (a: Article, status: Article["status"]) => updateArticleStatus(a, status),
}));

vi.mock("@/lib/data/highlights", () => ({
  createHighlight: async () => ({}),
  deleteHighlight: async () => undefined,
  deleteNote: async () => ({}),
  loadHighlights: async () => [],
  saveNote: async () => ({}),
}));

vi.mock("@/lib/auth/auth-provider", () => ({
  useAuth: () => ({ status: "anonymous", isAuthenticated: false }),
}));

vi.mock("@/lib/theme/theme-provider", () => ({
  useTheme: () => ({ theme: "light", setTheme: () => {} }),
}));

vi.mock("@/lib/reader/tts-player-provider", () => ({
  useTtsPlayer: () => ({
    status: "idle",
    supported: false,
    articleId: null,
    articleTitle: null,
    currentChunkText: null,
    currentChunkIndex: 0,
    totalChunks: 0,
    currentWordRange: null,
    play: () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    prewarmFirstChunk: () => {},
  }),
}));

// next/link resolves its own React through next/node_modules -- a second
// copy, which is the "Cannot read properties of null (reading 'useContext')"
// this workspace's render helper documents at length (#166). A plain <a> is
// all this test needs from it.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// next/dynamic's loader would try to actually import the PDF/EPUB readers
// (and through them pdfjs's worker URL); neither is reachable for an HTML
// article, which is all this file renders.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

import { DevicePrefsProvider } from "@/lib/data/device-prefs-provider";
import { ToastProvider } from "@/lib/toast/toast-provider";
import { ReaderView } from "./reader-view";

/** The two providers the reader genuinely reads from (text size, toasts).
 * Real rather than mocked: both are plain localStorage/state, and stubbing
 * them would only be stubbing this test's own setup. */
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <DevicePrefsProvider>{children}</DevicePrefsProvider>
    </ToastProvider>
  );
}

// A scrollable document -- jsdom does no layout, so scrollHeight is 0 and
// every scroll fraction would otherwise be 0, including the ones this is
// about.
const SCROLL_HEIGHT = 5000;
let scrollTop = 0;

function Harness({ initialId }: { initialId: string }) {
  const [id, setId] = useState(initialId);
  // Published from an effect rather than during render -- see the same note
  // in tts-player-provider.test.tsx.
  useEffect(() => {
    navigate = setId;
  }, []);
  return <ReaderView articleId={id} />;
}

let navigate: (id: string) => void;

/** Two rounds on purpose: act() only commits the state updates a promise
 * continuation produced when its own scope exits, so the effect that schedules
 * the scroll-resume frame doesn't run until the first round is over -- and the
 * frame it schedules only fires during the second. */
async function flush() {
  for (let i = 0; i < 2; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }
}

describe("ReaderView, navigating from one article to another", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    articles.clear();
    scrollTop = 0;
    Object.defineProperty(document.documentElement, "scrollHeight", {
      get: () => SCROLL_HEIGHT,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, "scrollTop", { get: () => scrollTop, configurable: true });
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  afterEach(cleanup);

  it("resumes the second article's saved position too", async () => {
    articles.set("a", article("a", 0.5, "READING"));
    articles.set("b", article("b", 0.25, "READING"));

    render(
      <Providers>
        <Harness initialId="a" />
      </Providers>,
    );
    await flush();
    expect(window.scrollTo).toHaveBeenCalledTimes(1);

    await act(async () => navigate("b"));
    await flush();

    const scrollable = SCROLL_HEIGHT - window.innerHeight;
    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: scrollable * 0.25 });
  });

  it("does not archive the second article using the first one's progress", async () => {
    // Scrolled to the very bottom of the finished article, which is what
    // leaves `progress` at 1 when the next one arrives.
    scrollTop = SCROLL_HEIGHT - window.innerHeight;
    articles.set("a", article("a", 1, "ARCHIVED"));
    articles.set("b", article("b", 0, "UNREAD"));

    render(
      <Providers>
        <Harness initialId="a" />
      </Providers>,
    );
    await flush();
    expect(updateArticleStatus).not.toHaveBeenCalled();

    await act(async () => navigate("b"));
    await flush();

    expect(updateArticleStatus).not.toHaveBeenCalled();
  });
});

describe("ReaderView when the article can't be loaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    articles.clear();
  });

  afterEach(cleanup);

  it("says so and offers a retry instead of rendering a blank page", async () => {
    loadArticle.mockRejectedValueOnce(new Error("network down"));

    render(
      <Providers>
        <ReaderView articleId="a" />
      </Providers>,
    );
    await flush();

    expect(document.body.textContent).toContain("Couldn't load this article");
    const retry = [...document.body.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(retry).toBeTruthy();

    // And the retry actually re-runs the load.
    articles.set("a", article("a", 0, "UNREAD"));
    await act(async () => retry!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();
    expect(document.body.textContent).toContain("Article a");
  });
});
