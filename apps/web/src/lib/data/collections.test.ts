/**
 * The local half of lib/data/collections.ts, against a real IndexedDB
 * (fake-indexeddb), because the bug this repo keeps hitting is a field or a
 * rule that one branch of the local-vs-synced swap honours and the other
 * quietly doesn't (#164, #171, #172). Ordering is one of those rules: it is
 * invisible in a diff, and both branches "work".
 *
 * Only the anonymous branch is exercised here -- the authenticated branch is
 * one apiFetch call whose behaviour belongs to apps/api's own route tests.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Article, Collection } from "@booklet/shared";
import { localArticleCollections, localArticles, localCollections } from "@/lib/local/db";
import { addArticleToCollection, loadArticlesInCollection } from "./collections";

function article(id: string, title: string): Article {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    userId: "local",
    url: null,
    canonicalUrl: null,
    title,
    author: null,
    siteName: null,
    excerpt: null,
    sourceType: "HTML",
    extractionStatus: "SUCCESS",
    extractionError: null,
    extractedHtml: null,
    extractedText: null,
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

const COLLECTION: Collection = {
  id: "c1",
  userId: "local",
  name: "Reading list",
  color: null,
  filter: null,
  parentId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  articleCount: 0,
};

describe("loadArticlesInCollection (local)", () => {
  beforeEach(async () => {
    await Promise.all([localArticles.clear(), localCollections.clear(), localArticleCollections.clear()]);
    await localCollections.put(COLLECTION);
  });

  it("returns a manual collection's articles most-recently-added first, like the server does", async () => {
    // Ids deliberately sort the *opposite* way to the add order: IndexedDB's
    // getAll walks the key index, so an implementation that doesn't sort
    // returns exactly this ascending-id order and looks fine until the ids
    // are real UUIDs and the order is simply arbitrary.
    await localArticles.put(article("a-1", "First added"));
    await localArticles.put(article("a-2", "Second added"));
    await localArticles.put(article("a-3", "Third added"));

    await localArticleCollections.put({
      id: "a-1:c1",
      articleId: "a-1",
      collectionId: "c1",
      addedAt: "2026-02-01T00:00:00.000Z",
    });
    await localArticleCollections.put({
      id: "a-2:c1",
      articleId: "a-2",
      collectionId: "c1",
      addedAt: "2026-02-02T00:00:00.000Z",
    });
    await localArticleCollections.put({
      id: "a-3:c1",
      articleId: "a-3",
      collectionId: "c1",
      addedAt: "2026-02-03T00:00:00.000Z",
    });

    const result = await loadArticlesInCollection("c1", false);
    expect(result.map((a) => a.title)).toEqual(["Third added", "Second added", "First added"]);
  });

  it("puts a just-added article at the top", async () => {
    await localArticles.put(article("a-1", "Older"));
    await localArticleCollections.put({
      id: "a-1:c1",
      articleId: "a-1",
      collectionId: "c1",
      addedAt: "2020-01-01T00:00:00.000Z",
    });
    await localArticles.put(article("a-0", "Just added"));
    await addArticleToCollection("a-0", "c1", false);

    const result = await loadArticlesInCollection("c1", false);
    expect(result.map((a) => a.title)).toEqual(["Just added", "Older"]);
  });

  it("skips a link whose article row is gone rather than yielding a hole", async () => {
    await localArticles.put(article("a-1", "Still here"));
    await localArticleCollections.put({
      id: "a-1:c1",
      articleId: "a-1",
      collectionId: "c1",
      addedAt: "2026-02-01T00:00:00.000Z",
    });
    await localArticleCollections.put({
      id: "ghost:c1",
      articleId: "ghost",
      collectionId: "c1",
      addedAt: "2026-02-02T00:00:00.000Z",
    });

    const result = await loadArticlesInCollection("c1", false);
    expect(result.map((a) => a.title)).toEqual(["Still here"]);
  });
});
