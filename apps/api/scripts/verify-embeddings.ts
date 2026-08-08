/**
 * Smoke-checks the real all-MiniLM-L6-v2 model, which the unit tests
 * deliberately stub out.
 *
 *   pnpm --filter @booklet/api exec tsx scripts/verify-embeddings.ts
 *
 * Two things worth proving separately:
 *
 *  1. The embedder's contract -- 384 dimensions, unit length. The shared
 *     maths and the stored Float[] both assume it.
 *  2. #156's actual claim: that a conceptual query finds text sharing none of
 *     its words. If this fails, semantic search is not worth having, however
 *     correct the plumbing is.
 */
import { cosineSimilarity } from "@booklet/shared";
import { EMBEDDING_DIMENSIONS, embedTexts } from "../src/services/embedding-service.js";

const QUERY = "why deadlines make people creative";

// Deliberately shares no content word with the query -- no "deadline", no
// "creative". Keyword search cannot find this; that is the entire point.
const RELATED = "Constraints and time pressure often sharpen inventiveness, forcing novel solutions under limited resources.";
const UNRELATED = "Boil the pasta in salted water for eleven minutes, then drain and add butter.";

async function main(): Promise<void> {
  console.log("loading model...");
  const [q, related, unrelated] = await embedTexts([QUERY, RELATED, UNRELATED]);

  const dims = q.length;
  const magnitude = Math.sqrt([...q].reduce((s, x) => s + x * x, 0));
  console.log(`dimensions: ${dims} (expected ${EMBEDDING_DIMENSIONS})`);
  console.log(`unit length: ${magnitude.toFixed(4)} (expected ~1.0)`);

  const relatedScore = cosineSimilarity(q, related);
  const unrelatedScore = cosineSimilarity(q, unrelated);
  console.log(`\nquery:     "${QUERY}"`);
  console.log(`related:   ${relatedScore.toFixed(4)}  <- shares NO content word with the query`);
  console.log(`unrelated: ${unrelatedScore.toFixed(4)}`);

  const ok =
    dims === EMBEDDING_DIMENSIONS &&
    Math.abs(magnitude - 1) < 0.01 &&
    relatedScore > unrelatedScore &&
    relatedScore > 0.2;

  console.log(`\n${ok ? "PASS" : "FAIL"}: conceptual match ${ok ? "beats" : "does NOT beat"} the unrelated text`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
