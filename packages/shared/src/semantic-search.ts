/**
 * The mode-independent half of semantic search (#156): similarity, chunking,
 * and the fusion that combines keyword and vector results.
 *
 * It lives in packages/shared for the same reason the TTS chunker does. The
 * server embeds with transformers.js under Node and the browser embeds with
 * transformers.js under WASM, and if those two ranked results by separately
 * written maths, "signed-in and local mode behave the same" would hold only
 * until one of them was edited. Here there is one implementation and both
 * sides call it.
 */

/**
 * Cosine similarity, in [-1, 1] -- higher is more alike.
 *
 * all-MiniLM-L6-v2 is normally asked for normalised output, and for unit
 * vectors cosine collapses to a plain dot product. This still divides by the
 * magnitudes rather than assuming that: the assumption is invisible when it
 * breaks (a caller forgetting `normalize`, or a vector round-tripped through
 * a lossy store) and produces silently wrong *ordering* rather than an error,
 * which is the worst kind of bug to have in a ranking function. The extra
 * cost is two multiply-accumulates per dimension on 384 floats.
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  // A zero vector has no direction, so it has no similarity to anything --
  // returning 0 rather than NaN keeps it merely irrelevant instead of
  // poisoning every comparison it takes part in.
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Splits article text into windows small enough to embed usefully.
 *
 * MiniLM truncates at 256 word pieces -- a few hundred characters. Embedding
 * a whole article therefore does not produce a blurry average of it, which is
 * the intuition people expect; it produces an embedding of the *opening* and
 * silently discards the rest. An article whose relevant passage is in the
 * middle would be unfindable.
 *
 * Windows overlap so a passage that straddles a boundary is still wholly
 * present in one of them. Splitting on whitespace rather than mid-token keeps
 * each window something the tokenizer sees as ordinary text.
 */
export function chunkForEmbedding(text: string, maxChars = 1200, overlapChars = 200): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxChars, normalized.length);
    if (end < normalized.length) {
      // Back off to the last space so a window never ends mid-word.
      const lastSpace = normalized.lastIndexOf(" ", end);
      if (lastSpace > start) end = lastSpace;
    }
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks.filter(Boolean);
}

export interface FusedResult {
  id: string;
  score: number;
}

/**
 * Reciprocal rank fusion.
 *
 * The problem it solves is that the two searches produce scores that mean
 * different things -- ts_rank is a weighted lexeme measure, cosine similarity
 * is an angle -- so they cannot be added, averaged, or compared without
 * inventing a conversion nobody can justify. RRF ignores the scores entirely
 * and uses only each list's *ordering*, which is the one thing both agree on
 * the meaning of.
 *
 * score(d) = sum over lists of 1 / (k + rank(d))
 *
 * `k` damps the top of each list: without it a first place would be worth
 * infinitely more than a second, so a single list could dictate the result. 60
 * is the value from the original paper and the usual default, and its effect
 * is that agreement between lists beats a strong showing in one -- exactly the
 * property wanted here, since a document both searches like is a better answer
 * than one either loves alone.
 *
 * This also gives the acceptance criterion "hybrid is not worse than keyword
 * alone for exact-term queries" for free: an exact-term hit that keyword
 * ranks first still lands first unless the vector list actively disagrees.
 */
export function reciprocalRankFusion(rankedLists: string[][], k = 60): FusedResult[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    for (const [index, id] of list.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1));
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    // Ties broken by id so the order is total and therefore reproducible --
    // otherwise two runs over the same data can disagree, which reads as
    // flakiness in tests and as jitter in the UI.
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Cosine-ranks candidate vectors against a query, best first. An article is
 * scored by its single best-matching chunk rather than an average: relevance
 * lives in a passage, and averaging lets a long article dilute a strong hit
 * into invisibility. */
export function rankBySimilarity(
  queryVector: ArrayLike<number>,
  candidates: { id: string; vector: ArrayLike<number> }[],
  minScore = 0.2,
): FusedResult[] {
  const best = new Map<string, number>();
  for (const c of candidates) {
    const score = cosineSimilarity(queryVector, c.vector);
    const prev = best.get(c.id);
    if (prev === undefined || score > prev) best.set(c.id, score);
  }
  return [...best.entries()]
    .filter(([, score]) => score >= minScore)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
