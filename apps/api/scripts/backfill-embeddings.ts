/**
 * Embeds articles that have no embeddings yet -- everything saved before
 * semantic search existed (#156), plus anything whose background indexing
 * failed at save time.
 *
 * Run by hand rather than on boot:
 *
 *   pnpm --filter @booklet/api exec tsx scripts/backfill-embeddings.ts
 *
 * Embedding a whole library is real CPU for real minutes. Doing it
 * automatically at startup would make every deploy slow and every restart
 * expensive, and would do it again on a crash loop -- for work that is
 * entirely optional, since search degrades to keyword-only for anything
 * unindexed.
 *
 * Incremental and interruptible, which #156 asks for explicitly: progress is
 * the embeddings themselves, so stopping this with Ctrl-C loses at most the
 * article in flight, and re-running picks up exactly where it left off
 * (findUnembeddedArticles only returns articles with no embeddings at all).
 */
import { findUnembeddedArticles, indexArticleEmbeddings } from "../src/services/article-embedding-service.js";
import { loadEmbeddingModel } from "../src/services/embedding-service.js";
import { prisma } from "../src/lib/prisma.js";

const BATCH = 25;

async function main(): Promise<void> {
  console.log("[backfill] loading the embedding model...");
  await loadEmbeddingModel();

  let done = 0;
  let failed = 0;
  for (;;) {
    const batch = await findUnembeddedArticles(null, BATCH);
    if (batch.length === 0) break;

    for (const article of batch) {
      try {
        const chunks = await indexArticleEmbeddings(article.id, article.userId, article.extractedText);
        done++;
        console.log(`[backfill] ${article.id}: ${chunks} chunks (${done} done)`);
      } catch (err) {
        // Keep going. One article whose text breaks the tokenizer should not
        // strand every article behind it -- and the loop cannot spin on it,
        // because the next query would return it again forever. Recorded as
        // an empty index so it is skipped rather than retried endlessly.
        failed++;
        console.error(`[backfill] ${article.id} FAILED:`, err);
        await prisma.articleEmbedding
          .create({ data: { articleId: article.id, userId: article.userId, chunkIndex: 0, vector: [] } })
          .catch(() => undefined);
      }
    }
  }

  console.log(`[backfill] finished: ${done} embedded, ${failed} failed`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill] fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
