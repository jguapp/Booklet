import type { Highlight } from "./types/highlight";

export interface DigestEmailContent {
  subject: string;
  textBody: string;
}

/** Pure -- the actual send (or console-log stub) lives in apps/api's email service. */
export function compileDigestEmail(
  highlights: Highlight[],
  articleTitleById: Map<string, { title: string | null }>,
): DigestEmailContent {
  const lines = highlights.map((h) => {
    const article = articleTitleById.get(h.articleId);
    const note = h.annotation ? `\n  Note: ${h.annotation.noteText}` : "";
    return `- "${h.selectedText}"${note}\n  From: ${article?.title ?? "Untitled"}`;
  });

  return {
    subject: `Your Booklet digest — ${highlights.length} highlight${highlights.length === 1 ? "" : "s"} to revisit`,
    textBody: `Here's what came up today:\n\n${lines.join("\n\n")}`,
  };
}
