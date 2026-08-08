/**
 * Keeps ArticleEmbedding rows in step with article text, and answers
 * similarity queries over them (#156).
 *
 * The split from embedding-service.ts is deliberate: that one owns the model
 * and knows nothing about articles or the database, this one owns the
 * persistence and knows nothing about how a vector is produced. It is also
 * what makes this file testable without loading a 25MB model, since the
 * embedder is injectable.
 */
import { chunkForEmbedding, rankBySimilarity, type FusedResult } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { embedTexts } from "./embedding-service.js";

/** Injectable purely so tests can supply deterministic vectors instead of
 * loading a real model -- production always uses the real embedder. */
export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

/**
 * Replaces an article's embeddings.
 *
 * deleteMany-then-createMany rather than a diff: an article's text changes
 * rarely (a re-extraction, a PDF re-OCR), chunk boundaries shift wholesale
 * when it does, and matching old chunks to new ones would be more code than
 * the write it saves. Both statements run in one transaction so a failure
 * mid-way cannot leave an article indexed by a mixture of two versions --
 * which would rank it against text it no longer contains.
 */
export async function indexArticleEmbeddings(
  articleId: string,
  userId: string,
  text: string | null,
  embed: Embedder = embedTexts,
): Promise<number> {
  const chunks = chunkForEmbedding(text ?? "");
  if (chunks.length === 0) {
    await prisma.articleEmbedding.deleteMany({ where: { articleId } });
    return 0;
  }

  const vectors = await embed(chunks);
  await prisma.$transaction([
    prisma.articleEmbedding.deleteMany({ where: { articleId } }),
    prisma.articleEmbedding.createMany({
      data: vectors.map((vector, chunkIndex) => ({
        articleId,
        userId,
        chunkIndex,
        // Prisma's Float[] is a JS number[]; Float32Array would serialize as
        // an object rather than an array of numbers.
        vector: Array.from(vector),
      })),
    }),
  ]);
  return chunks.length;
}

/**
 * Ranks a user's articles against a query vector.
 *
 * Every candidate vector is loaded and compared in process, which sounds
 * profligate and is the deliberate trade recorded on the schema: pgvector is
 * not available in the postgres:16 image CI and compose both run, so an ANN
 * index would cost a new extension and an image change everywhere. At one
 * person's library this is a few thousand 384-float dot products -- single
 * digit milliseconds. The moment a library is large enough for that to be the
 * bottleneck is the moment pgvector earns its dependency.
 *
 * Trashed articles are excluded here rather than by deleting their embeddings,
 * so restoring from trash does not require re-embedding.
 */
export async function searchByEmbedding(
  userId: string,
  queryVector: Float32Array,
  limit: number,
): Promise<FusedResult[]> {
  const rows = await prisma.articleEmbedding.findMany({
    where: { userId, article: { deletedAt: null } },
    select: { articleId: true, vector: true },
  });
  if (rows.length === 0) return [];

  return rankBySimilarity(
    queryVector,
    rows.map((r) => ({ id: r.articleId, vector: r.vector })),
  ).slice(0, limit);
}

/** Articles with text but no embeddings yet -- everything saved before this
 * feature existed, plus anything whose indexing failed. Used by the backfill
 * script rather than run automatically: embedding a whole library is real
 * work and should be something a human starts, not a surprise on boot. */
export async function findUnembeddedArticles(userId: string | null, limit: number) {
  return prisma.article.findMany({
    where: {
      ...(userId ? { userId } : {}),
      deletedAt: null,
      extractedText: { not: null },
      embeddings: { none: {} },
    },
    select: { id: true, userId: true, extractedText: true },
    take: limit,
  });
}
