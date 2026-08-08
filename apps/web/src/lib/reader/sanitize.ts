/**
 * Browser-side sanitization of article HTML, applied at the moment of
 * render.
 *
 * The policy comes from @booklet/shared (ARTICLE_SANITIZE_CONFIG), the same
 * object the API sanitizes with, so the two cannot drift apart.
 *
 * ## Why sanitize here when the server already did
 *
 * Three reasons, and the first is decisive:
 *
 * 1. **Everything saved before the server-side fix existed is still
 *    hostile.** Those rows are in the database now. Sanitizing on the way in
 *    protects nothing that is already stored, and there is no migration that
 *    can be trusted to have found every one.
 * 2. **Local/anonymous mode never touches the API's storage path.** Articles
 *    live in IndexedDB. Whatever the server does on save is irrelevant to a
 *    reader who never signed up.
 * 3. This is the last line before `dangerouslySetInnerHTML`, and it is the
 *    only one that is true regardless of how the HTML arrived.
 *
 * DOMPurify runs against the real `window` here, which is both faster and
 * more faithful than jsdom -- it sees exactly the parser that will render
 * the result.
 */
import DOMPurify from "dompurify";
import { ARTICLE_SANITIZE_CONFIG } from "@booklet/shared";

/**
 * Strips anything executable from article HTML.
 *
 * Returns "" for absent input so callers can pass it straight into
 * `{ __html }` without a null check.
 *
 * On the server (Next.js renders these components on the server first)
 * there is no `window`, and DOMPurify cannot work without one. Returning
 * empty rather than the raw string is deliberate: an article that flashes
 * empty for one paint and then renders on hydration is a cosmetic problem,
 * where returning the unsanitized string would defeat the entire module on
 * the one render path nobody tests by hand.
 */
export function sanitizeArticleHtml(html: string | null | undefined): string {
  if (typeof html !== "string" || html.length === 0) return "";
  if (typeof window === "undefined") return "";
  return DOMPurify.sanitize(html, ARTICLE_SANITIZE_CONFIG);
}
