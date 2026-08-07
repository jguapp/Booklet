import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import {
  findUnembeddedArticles,
  indexArticleEmbeddings,
  searchByEmbedding,
} from "../services/article-embedding-service.js";

/**
 * The storage and retrieval half of semantic search (#156).
 *
 * Deliberately runs with a stub embedder rather than all-MiniLM-L6-v2. Loading
 * a 25MB model would make these tests slow, dependent on huggingface.co being
 * reachable, and would test the model rather than this code -- while the thing
 * that can actually break here is the persistence: stale chunks surviving a
 * re-index, ordering lost, trashed articles leaking into results. Stub vectors
 * make every one of those assertable exactly.
 *
 * The real model is exercised where it belongs: the embedder's own contract
 * (unit-length 384-dim output) is what the shared maths depends on, and the
 * route degrades to keyword-only if the model is unavailable at all.
 */

/** Deterministic unit vectors on a 3-dim space, so similarity is obvious by
 * inspection instead of being an opaque number. */
function stubEmbedder(vectorsByChunk: Record<string, number[]>, fallback = [0, 0, 1]) {
  return async (texts: string[]) =>
    texts.map((t) => {
      const key = Object.keys(vectorsByChunk).find((k) => t.includes(k));
      return Float32Array.from(key ? vectorsByChunk[key] : fallback);
    });
}

describe("article embeddings", () => {
  let userId: string;
  const email = `embeddings-${Date.now()}@example.com`;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { email } });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.article.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function makeArticle(id: string, text: string | null, extra: Record<string, unknown> = {}) {
    return prisma.article.create({
      data: {
        id: `${userId}-${id}`,
        userId,
        title: id,
        extractedText: text,
        sourceType: "HTML",
        extractionStatus: "SUCCESS",
        ...extra,
      },
    });
  }

  it("indexes one row per chunk", async () => {
    const article = await makeArticle("chunked", "alpha ".repeat(600));
    const count = await indexArticleEmbeddings(article.id, userId, article.extractedText, stubEmbedder({}));
    expect(count).toBeGreaterThan(1); // long enough to require several windows

    const rows = await prisma.articleEmbedding.findMany({ where: { articleId: article.id } });
    expect(rows).toHaveLength(count);
    // Chunk indexes are contiguous from zero, which is what makes them a
    // stable identity for a window rather than an arbitrary label.
    expect(rows.map((r) => r.chunkIndex).sort((a, b) => a - b)).toEqual([...Array(count).keys()]);
    expect(rows[0].vector).toHaveLength(3);
  });

  it("replaces old chunks on re-index rather than accumulating them", async () => {
    const article = await makeArticle("reindexed", "alpha ".repeat(600));
    await indexArticleEmbeddings(article.id, userId, article.extractedText, stubEmbedder({}));

    // Re-index with much shorter text: the leftover chunks from the long
    // version would otherwise keep matching text the article no longer has.
    const after = await indexArticleEmbeddings(article.id, userId, "short text now", stubEmbedder({}));
    const rows = await prisma.articleEmbedding.findMany({ where: { articleId: article.id } });
    expect(after).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it("clears embeddings when an article loses its text", async () => {
    const article = await makeArticle("emptied", "some text");
    await indexArticleEmbeddings(article.id, userId, article.extractedText, stubEmbedder({}));
    await indexArticleEmbeddings(article.id, userId, null, stubEmbedder({}));
    expect(await prisma.articleEmbedding.count({ where: { articleId: article.id } })).toBe(0);
  });

  it("ranks by similarity, closest first", async () => {
    const near = await makeArticle("near", "near-marker text");
    const far = await makeArticle("far", "far-marker text");
    const embed = stubEmbedder({ "near-marker": [1, 0, 0], "far-marker": [0, 1, 0] });
    await indexArticleEmbeddings(near.id, userId, near.extractedText, embed);
    await indexArticleEmbeddings(far.id, userId, far.extractedText, embed);

    const results = await searchByEmbedding(userId, Float32Array.from([1, 0, 0]), 10);
    expect(results[0].id).toBe(near.id);
    expect(results[0].score).toBeGreaterThan(results.find((r) => r.id === far.id)?.score ?? -1);
  });

  it("excludes trashed articles without discarding their embeddings", async () => {
    const trashed = await makeArticle("trashed", "trash-marker text", { deletedAt: new Date() });
    const embed = stubEmbedder({ "trash-marker": [1, 0, 0] });
    await indexArticleEmbeddings(trashed.id, userId, trashed.extractedText, embed);

    const results = await searchByEmbedding(userId, Float32Array.from([1, 0, 0]), 10);
    expect(results.map((r) => r.id)).not.toContain(trashed.id);
    // Kept, so restoring from trash does not require re-embedding.
    expect(await prisma.articleEmbedding.count({ where: { articleId: trashed.id } })).toBeGreaterThan(0);
  });

  it("does not leak another user's articles", async () => {
    const other = await prisma.user.create({ data: { email: `other-${Date.now()}@example.com` } });
    const theirs = await prisma.article.create({
      data: {
        id: `${other.id}-theirs`,
        userId: other.id,
        title: "theirs",
        extractedText: "shared-marker text",
        sourceType: "HTML",
        extractionStatus: "SUCCESS",
      },
    });
    const embed = stubEmbedder({ "shared-marker": [1, 0, 0] });
    await indexArticleEmbeddings(theirs.id, other.id, theirs.extractedText, embed);

    const results = await searchByEmbedding(userId, Float32Array.from([1, 0, 0]), 10);
    expect(results.map((r) => r.id)).not.toContain(theirs.id);

    await prisma.article.deleteMany({ where: { userId: other.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("cascades embeddings away when the article is deleted", async () => {
    const doomed = await makeArticle("doomed", "doomed text");
    await indexArticleEmbeddings(doomed.id, userId, doomed.extractedText, stubEmbedder({}));
    await prisma.article.delete({ where: { id: doomed.id } });
    expect(await prisma.articleEmbedding.count({ where: { articleId: doomed.id } })).toBe(0);
  });

  it("finds articles that still need embedding, and stops finding them once indexed", async () => {
    const pending = await makeArticle("pending", "needs embedding");
    const before = await findUnembeddedArticles(userId, 50);
    expect(before.map((a) => a.id)).toContain(pending.id);

    await indexArticleEmbeddings(pending.id, userId, pending.extractedText, stubEmbedder({}));
    const after = await findUnembeddedArticles(userId, 50);
    expect(after.map((a) => a.id)).not.toContain(pending.id);
  });
});
