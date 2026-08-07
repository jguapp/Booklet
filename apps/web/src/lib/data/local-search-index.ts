import MiniSearch from "minisearch";
import { stemmer } from "stemmer";
import type { Article, Highlight } from "@booklet/shared";
import { SNIPPET_MARK_END, SNIPPET_MARK_START } from "@booklet/shared";

/**
 * The local/anonymous half of ranked search (#155).
 *
 * This exists so the server could stop being held back. Search used to be a
 * plain `contains` on both sides, and Postgres full-text search was rejected
 * *specifically* because local mode had no equivalent -- giving signed-in
 * users better search than signed-out users contradicts this app's "behaves
 * the same either way" principle. The fix for that objection is to give local
 * mode a real index, not to keep the server dumb.
 *
 * Exact parity with Postgres is explicitly NOT the goal, and should not be
 * read as a bug later: MiniSearch scores BM25-ish, ts_rank scores by weighted
 * lexeme position, and the two will order near-ties differently. What is kept
 * comparable is the behaviour a reader would notice -- stemming, multi-word
 * AND, field weighting that puts a title hit above a body mention, and a
 * snippet showing why something matched.
 */

// The same Porter stemming Postgres's 'english' config applies, so "running"
// finds "runs" here too. It is Porter rather than Postgres's Snowball
// (Porter2), which differ on a handful of words -- another place the two
// modes are comparable rather than identical.
function processTerm(term: string): string | null {
  const lower = term.toLowerCase();
  // One-character tokens are noise in an index this size and blow up the
  // term dictionary for nothing.
  if (lower.length < 2) return null;
  return stemmer(lower);
}

const ARTICLE_FIELDS = ["title", "author", "siteName", "excerpt", "tags", "extractedText"] as const;

/** Mirrors the migration's A-D column weights closely enough that a title hit
 * outranks a passing mention in a long body, which is the ordering difference
 * a reader actually notices. */
const ARTICLE_FIELD_BOOST = { title: 8, author: 4, siteName: 4, tags: 4, excerpt: 2, extractedText: 1 };

interface IndexedArticle {
  id: string;
  title: string;
  author: string;
  siteName: string;
  excerpt: string;
  tags: string;
  extractedText: string;
}

function toIndexed(a: Article): IndexedArticle {
  return {
    id: a.id,
    title: a.title ?? "",
    author: a.author ?? "",
    siteName: a.siteName ?? "",
    excerpt: a.excerpt ?? "",
    tags: a.tags.join(" "),
    extractedText: a.extractedText ?? "",
  };
}

function newArticleIndex(): MiniSearch<IndexedArticle> {
  return new MiniSearch<IndexedArticle>({
    fields: [...ARTICLE_FIELDS],
    storeFields: [],
    processTerm,
    searchOptions: {
      // AND, so "flow state attention" requires all three somewhere in the
      // document rather than being one literal substring -- the specific
      // thing that used to match nothing. Matches websearch_to_tsquery's
      // treatment of a bare multi-word query.
      combineWith: "AND",
      boost: ARTICLE_FIELD_BOOST,
      // Light fuzziness for typos. Deliberately small: at higher values a
      // short query starts matching unrelated words and the ranking stops
      // meaning anything.
      fuzzy: 0.15,
      prefix: true,
    },
  });
}

/**
 * The index is rebuilt only when the library actually changes, never per
 * keystroke -- searching is the common case and rebuilding on every one would
 * be visible on a real library. `signature` is what "actually changed" means:
 * the article count plus the newest updatedAt, which moves on any create,
 * edit, rename, tag or trash. Cheap to compute from data the caller already
 * has in hand.
 */
let cached: { signature: string; index: MiniSearch<IndexedArticle> } | null = null;

function signatureOf(articles: Article[]): string {
  let newest = "";
  for (const a of articles) if (a.updatedAt > newest) newest = a.updatedAt;
  return `${articles.length}:${newest}`;
}

export function getArticleIndex(articles: Article[]): MiniSearch<IndexedArticle> {
  const signature = signatureOf(articles);
  if (cached && cached.signature === signature) return cached.index;

  const index = newArticleIndex();
  index.addAll(articles.map(toIndexed));
  cached = { signature, index };
  return index;
}

/** Only for tests -- a module-level cache otherwise leaks between cases. */
export function resetArticleIndexCache(): void {
  cached = null;
}

const SNIPPET_RADIUS = 90;

/**
 * The local equivalent of ts_headline: a short window of body text around the
 * first matched term, with matches wrapped in the shared sentinels.
 *
 * Uses the same control-character markers rather than `<mark>` for the same
 * reason the server does -- this is article text the app did not author, so
 * emitting HTML would put it one `dangerouslySetInnerHTML` away from being
 * executed. The UI splits on the sentinels instead.
 */
export function buildSnippet(text: string, queryTerms: string[]): string | null {
  if (!text) return null;
  const stems = queryTerms.map((t) => processTerm(t)).filter((t): t is string => t !== null);
  if (stems.length === 0) return null;

  // Word positions, so a match can be located without a regex built from
  // user input (which would need escaping and could still be pathological).
  const words = [...text.matchAll(/\S+/g)];
  let hitIndex = -1;
  for (let i = 0; i < words.length; i++) {
    const stem = processTerm(words[i][0].replace(/[^\p{L}\p{N}]/gu, ""));
    if (stem && stems.includes(stem)) {
      hitIndex = i;
      break;
    }
  }
  if (hitIndex === -1) return null;

  const hitAt = words[hitIndex].index;
  const start = Math.max(0, hitAt - SNIPPET_RADIUS);
  const end = Math.min(text.length, hitAt + SNIPPET_RADIUS);
  const slice = text.slice(start, end);

  // Mark every matching word in the window, not only the one that was found
  // first -- a snippet showing one highlighted word out of three reads as if
  // the others did not match.
  const marked = slice.replace(/\S+/g, (word) => {
    const stem = processTerm(word.replace(/[^\p{L}\p{N}]/gu, ""));
    return stem && stems.includes(stem) ? `${SNIPPET_MARK_START}${word}${SNIPPET_MARK_END}` : word;
  });

  return `${start > 0 ? "…" : ""}${marked.trim()}${end < text.length ? "…" : ""}`;
}

/** Highlights are short strings where ranking has little to order, so they
 * keep per-term substring matching -- but per *term*, so a multi-word query
 * behaves the same way it does for articles instead of silently matching
 * nothing. Mirrors what the server route does for the same reason. */
export function matchesAllTerms(haystacks: (string | null | undefined)[], terms: string[]): boolean {
  const joined = haystacks.filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => joined.includes(term.toLowerCase()));
}

export function highlightMatches(h: Highlight, terms: string[]): boolean {
  return matchesAllTerms([h.selectedText, h.annotation?.noteText], terms);
}
