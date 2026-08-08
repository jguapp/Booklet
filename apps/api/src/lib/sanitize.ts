/**
 * Server-side sanitization of extracted article HTML.
 *
 * The policy lives in @booklet/shared (ARTICLE_SANITIZE_CONFIG) so this and
 * the browser's copy cannot disagree about what is safe; this file is only
 * the plumbing that gives DOMPurify a DOM to work against, which on the
 * server means jsdom -- already a dependency, since Readability needs one.
 *
 * This is the *second* line of defence, not the first. The client sanitizes
 * again at render (see apps/web/src/lib/reader/sanitize.ts), because
 * sanitizing only here would leave every article stored before this existed
 * dangerous forever, and would do nothing for HTML that reaches the reader
 * by another route. Sanitizing only there would mean knowingly storing
 * hostile markup and trusting every future consumer -- the mobile app, an
 * export, a share page -- to remember.
 *
 * One window is created and reused. Constructing a jsdom per article costs
 * tens of milliseconds and this runs on the save path.
 */
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import { ARTICLE_SANITIZE_CONFIG } from "@booklet/shared";

const purify = createDOMPurify(new JSDOM("").window as unknown as Window & typeof globalThis);

/**
 * Returns the article HTML with anything that can execute removed.
 *
 * Null-safe because every caller's value is nullable: a failed extraction
 * stores null, and passing that through unchanged is correct.
 */
export function sanitizeArticleHtml(html: string | null | undefined): string | null {
  if (typeof html !== "string" || html.length === 0) return null;
  return purify.sanitize(html, ARTICLE_SANITIZE_CONFIG);
}
