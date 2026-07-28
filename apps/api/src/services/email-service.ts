/**
 * Provider-agnostic email sending. Uses Resend's HTTP API directly (no SDK
 * dependency needed for a single POST) when RESEND_API_KEY is set;
 * otherwise logs to the console so every email-triggering flow (password
 * reset, email verification, digest emails) still works end to end in dev
 * without a real provider account. Swapping providers means replacing the
 * body of `send`, not touching any of its callers.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const RESEND_API_URL = "https://api.resend.com/emails";

async function sendViaResend(message: EmailMessage, apiKey: string): Promise<void> {
  const from = process.env.EMAIL_FROM ?? "Booklet <onboarding@resend.dev>";
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${body}`);
  }
}

function sendViaConsole(message: EmailMessage): void {
  // eslint-disable-next-line no-console
  console.log(
    `[email stub] No RESEND_API_KEY set -- logging instead of sending.\n  to: ${message.to}\n  subject: ${message.subject}\n  body: ${message.text}`,
  );
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    await sendViaResend(message, apiKey);
    return;
  }
  sendViaConsole(message);
}
