const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is", "it",
  "no", "not", "of", "on", "or", "such", "that", "the", "their", "then", "there", "these", "they",
  "this", "to", "was", "will", "with", "how", "why", "what", "your", "you", "from", "about",
]);

/**
 * Minimal shape the scorer needs -- deliberately not the full Article, same
 * reasoning as ReadingStatsCandidate/ResurfaceCandidate: stays a pure
 * function callers can unit-test with plain objects.
 */
export interface RelatedArticleCandidate {
  id: string;
  title: string | null;
  siteName: string | null;
  author: string | null;
  tags: string[];
}

function titleWords(title: string | null): Set<string> {
  if (!title) return new Set();
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * No embeddings/semantic-search infra exists yet (that's a separate,
 * bigger issue) -- this is the cheap stand-in: shared tags (Jaccard),
 * same site or author, and title keyword overlap. Ranking, not a hard
 * cutoff, so it degrades gracefully rather than returning nothing when a
 * library is small or sparsely tagged. Swappable later for an
 * embedding-based ranker without changing the caller's shape (still just
 * "give me the target + candidates, get back an ordered subset").
 */
export function computeRelatedArticles<T extends RelatedArticleCandidate>(
  target: T,
  candidates: T[],
  limit = 5,
): T[] {
  const targetTags = new Set(target.tags);
  const targetWords = titleWords(target.title);

  const scored = candidates
    .filter((c) => c.id !== target.id)
    .map((c) => {
      let score = jaccard(targetTags, new Set(c.tags)) * 3; // shared tags are the strongest signal
      score += jaccard(targetWords, titleWords(c.title)) * 2;
      if (target.siteName && c.siteName && target.siteName === c.siteName) score += 1;
      if (target.author && c.author && target.author === c.author) score += 1;
      return { article: c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.article);
}
