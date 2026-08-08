import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@booklet/shared";

/**
 * loadArticlesWithText, the fix for the one place lib/data/articles.ts's
 * `Article[]` return type isn't true.
 *
 * Signed in, GET /api/articles answers with summaries: no extractedHtml, no
 * extractedText. Every caller that only lists articles is fine with that, and
 * the Markdown export -- which writes `article.extractedText` into each file
 * -- was not: it produced whole articles signed out and bodyless ones signed
 * in. This is the local-vs-synced asymmetry the module is meant to hide, so
 * it's pinned here at the swap point rather than through the exporter.
 */

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (path: string, options?: unknown) => apiFetch(path, options),
  apiFetchBlob: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/local/db", () => ({
  localArticles: { getAll: async () => localRows, getTrash: async () => [], get: async () => undefined },
  localFiles: { get: async () => undefined, delete: async () => undefined },
}));

vi.mock("@/lib/data/sync", () => ({ pendingFileUploadFor: () => null }));

let localRows: Article[] = [];

import { loadArticlesWithText } from "./articles";

const now = "2026-01-01T00:00:00.000Z";
function article(id: string, extractedText: string | null): Article {
  return {
    id,
    userId: "u1",
    url: `https://example.com/${id}`,
    canonicalUrl: null,
    title: `Article ${id}`,
    author: null,
    siteName: null,
    excerpt: null,
    sourceType: "HTML",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: null,
    extractedText,
    textSource: null,
    fileStorageKey: null,
    originalFilename: null,
    coverImageUrl: null,
    readingTimeEstimate: null,
    skippedImageCount: 0,
    progressFraction: 0,
    activeReadingSeconds: 0,
    listeningFraction: null,
    listeningUpdatedAt: null,
    listeningDeviceId: null,
    tags: [],
    status: "UNREAD",
    savedAt: now,
    readAt: null,
    archivedAt: null,
    favorited: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** What the list endpoint really sends: the summary, with the two body
 * fields absent rather than null. */
function summaryOf(a: Article): Record<string, unknown> {
  const row: Record<string, unknown> = { ...a };
  delete row.extractedHtml;
  delete row.extractedText;
  return row;
}

describe("loadArticlesWithText, signed in", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    localRows = [];
  });

  it("fills in the body text the list endpoint leaves out", async () => {
    const full = [article("a", "Body of A."), article("b", "Body of B.")];
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/articles?")) {
        return { articles: full.map(summaryOf), nextCursor: null };
      }
      const id = path.replace("/api/articles/", "");
      return full.find((a) => a.id === id);
    });

    const result = await loadArticlesWithText(true);
    expect(result.map((a) => a.extractedText)).toEqual(["Body of A.", "Body of B."]);
  });

  it("keeps the summary for an article whose own fetch fails, and still returns the rest", async () => {
    const full = [article("a", "Body of A."), article("b", "Body of B.")];
    apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/articles?")) return { articles: full.map(summaryOf), nextCursor: null };
      if (path === "/api/articles/a") throw new Error("500");
      return full[1];
    });

    const result = await loadArticlesWithText(true);
    expect(result).toHaveLength(2);
    expect(result[0].extractedText).toBeUndefined();
    expect(result[1].extractedText).toBe("Body of B.");
  });
});

describe("loadArticlesWithText, signed out", () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it("returns the IndexedDB rows as they are -- they already carry their text", async () => {
    localRows = [article("a", "Local body.")];
    const result = await loadArticlesWithText(false);
    expect(result.map((a) => a.extractedText)).toEqual(["Local body."]);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
