import type { Article, Highlight } from "@booklet/shared";

/**
 * The "clear seam" for a real email provider (SendGrid/Postmark/etc.) --
 * compiling the digest is real and reusable; sending it is a stub until a
 * provider is wired up, per the resurfacing phase's explicit scope.
 */
export interface DigestEmailContent {
  subject: string;
  textBody: string;
}

export function compileDigestEmail(highlights: Highlight[], articleById: Map<string, Article>): DigestEmailContent {
  const lines = highlights.map((h) => {
    const article = articleById.get(h.articleId);
    const note = h.annotation ? `\n  Note: ${h.annotation.noteText}` : "";
    return `- "${h.selectedText}"${note}\n  From: ${article?.title ?? "Untitled"}`;
  });

  return {
    subject: `Your Booklet digest — ${highlights.length} highlight${highlights.length === 1 ? "" : "s"} to revisit`,
    textBody: `Here's what came up today:\n\n${lines.join("\n\n")}`,
  };
}

export function sendDigestEmail(content: DigestEmailContent): void {
  // No email provider wired up yet -- log instead of sending, as scoped.
  // eslint-disable-next-line no-console
  console.log("[digest email stub]", content);
}
