/**
 * Wraps plain extracted text (PDF/EPUB) in <p> tags so it can go through the
 * same ArticleContent renderer as HTML articles -- that component only ever
 * treats its container as "a DOM with text in it" for highlighting purposes,
 * so it works on any HTML, not just Readability output.
 */
export function textToParagraphHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
