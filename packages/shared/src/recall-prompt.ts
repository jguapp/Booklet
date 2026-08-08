/**
 * Recall prompts (#157) -- the optional question whose answer is the
 * highlight.
 *
 * Resurfacing without one shows you the passage and then asks whether you
 * remembered it, which is the illusion-of-knowing trap: recognition feels
 * like recall but isn't, so the REMEMBERED/FORGOT grade being fed into SM-2
 * (resurface.ts) is measuring the wrong thing. A prompt reverses the order --
 * question first, answer on demand -- and turns the same scheduler into what
 * it was designed for: scheduling retrieval attempts.
 *
 * Everything here is deliberately trivial and deliberately shared. Four
 * places accept a prompt (the API's create and patch, the v1 public API, the
 * import route) and three more construct one locally (web local mode, mobile
 * local mode, and the import payload); they all need to agree on exactly one
 * rule, and "" / "   " must become null rather than a stored empty string --
 * a highlight whose prompt is a blank line looks prompted to every check in
 * the app and asks the reader nothing.
 */

/**
 * Long enough for a real question with context, short enough that a prompt
 * stays a prompt. Prompts are shown in full on a review card (no truncation
 * anywhere), so this is the practical limit on that card's height as much as
 * it is a storage bound.
 */
export const MAX_RECALL_PROMPT_LENGTH = 500;

/**
 * The one normalization rule: trim, and treat whitespace-only as absent.
 * Returns null for anything that isn't a usable prompt, including undefined,
 * so callers can assign the result straight into a `prompt: string | null`
 * field without a second check.
 *
 * Deliberately does NOT enforce the length cap -- silently truncating
 * someone's question would be worse than either storing it or refusing it.
 * Callers that validate untrusted input use isValidRecallPrompt for that.
 */
export function normalizeRecallPrompt(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether an incoming value is an acceptable prompt. null and undefined pass
 * -- "no prompt" is the normal case and clearing one is a legitimate edit --
 * so this is a rejection check on *bad* input, not a presence check. Use
 * normalizeRecallPrompt for that.
 */
export function isValidRecallPrompt(value: unknown): value is string | null | undefined {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return value.trim().length <= MAX_RECALL_PROMPT_LENGTH;
}
