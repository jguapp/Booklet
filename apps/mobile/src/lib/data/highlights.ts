/**
 * The local-vs-synced swap point for highlights -- mirrors the web app's
 * lib/data/highlights.ts: create/list/delete while reading, list-all +
 * feedback for resurfacing, and (since HighlightsScreen landed) notes and
 * recall prompts. saveNote / deleteNote / saveHighlightPrompt used to be
 * deliberately absent because no mobile screen had the control that would
 * call them -- that screen exists now.
 */
import type { Annotation, Highlight, HighlightColor, HighlightPosition, UpdateHighlightRequest } from "@booklet/shared";
import { DEFAULT_SM2_STATE, normalizeRecallPrompt } from "@booklet/shared";
import { apiFetch } from "../api";
import { generateLocalId, localHighlights } from "../local/db";

export async function loadHighlights(articleId: string | undefined, authenticated: boolean): Promise<Highlight[]> {
  if (authenticated) {
    const params = articleId ? `?articleId=${encodeURIComponent(articleId)}` : "";
    return apiFetch<Highlight[]>(`/api/highlights${params}`);
  }
  return articleId ? localHighlights.getForArticle(articleId) : localHighlights.getAll();
}

interface CreateHighlightInput {
  articleId: string;
  selectedText: string;
  position: HighlightPosition;
  color: HighlightColor;
}

export async function createHighlight(input: CreateHighlightInput, authenticated: boolean): Promise<Highlight> {
  if (authenticated) {
    return apiFetch<Highlight>("/api/highlights", { method: "POST", body: JSON.stringify(input) });
  }

  const now = new Date().toISOString();
  const highlight: Highlight = {
    id: generateLocalId(),
    articleId: input.articleId,
    userId: "local",
    selectedText: input.selectedText,
    position: input.position,
    color: input.color,
    // Highlights are created bare; a prompt is added afterwards from
    // HighlightsScreen (saveHighlightPrompt below), same flow as the web.
    prompt: null,
    lastSurfacedAt: null,
    surfaceCount: 0,
    lastFeedback: null,
    lastFeedbackAt: null,
    resurfaceArchivedAt: null,
    ...DEFAULT_SM2_STATE,
    nextDueAt: null,
    createdAt: now,
    updatedAt: now,
    annotation: null,
  };
  await localHighlights.put(highlight);
  return highlight;
}

export async function deleteHighlight(id: string, authenticated: boolean): Promise<void> {
  if (authenticated) {
    await apiFetch(`/api/highlights/${id}`, { method: "DELETE" });
    return;
  }
  await localHighlights.delete(id);
}

export async function saveNote(highlight: Highlight, noteText: string, authenticated: boolean): Promise<Highlight> {
  if (authenticated) {
    return apiFetch<Highlight>(`/api/highlights/${highlight.id}/annotation`, {
      method: "PUT",
      body: JSON.stringify({ noteText }),
    });
  }
  const now = new Date().toISOString();
  // generateLocalId, not crypto.randomUUID like the web's local branch --
  // Hermes doesn't guarantee WebCrypto, and the local id generator is
  // already what every other locally-created row here uses.
  const annotation: Annotation = highlight.annotation
    ? { ...highlight.annotation, noteText, updatedAt: now }
    : { id: generateLocalId(), highlightId: highlight.id, userId: "local", noteText, createdAt: now, updatedAt: now };
  const updated: Highlight = { ...highlight, annotation };
  await localHighlights.put(updated);
  return updated;
}

export async function deleteNote(highlight: Highlight, authenticated: boolean): Promise<Highlight> {
  if (authenticated) {
    return apiFetch<Highlight>(`/api/highlights/${highlight.id}/annotation`, { method: "DELETE" });
  }
  const updated: Highlight = { ...highlight, annotation: null };
  await localHighlights.put(updated);
  return updated;
}

/**
 * Set or clear a highlight's recall prompt (#157). Its own function rather
 * than a call into updateHighlightFeedback below, same as the web app --
 * writing a prompt is an edit, not a review judgment. Passing null (or an
 * emptied input) removes the prompt, which puts the highlight back on the
 * plain show-then-grade path in Daily Review.
 */
export async function saveHighlightPrompt(
  highlight: Highlight,
  prompt: string | null,
  authenticated: boolean,
): Promise<Highlight> {
  const normalized = normalizeRecallPrompt(prompt);
  if (authenticated) {
    return apiFetch<Highlight>(`/api/highlights/${highlight.id}`, {
      method: "PATCH",
      body: JSON.stringify({ prompt: normalized } satisfies UpdateHighlightRequest),
    });
  }
  const updated: Highlight = { ...highlight, prompt: normalized, updatedAt: new Date().toISOString() };
  await localHighlights.put(updated);
  return updated;
}

export async function updateHighlightFeedback(
  highlight: Highlight,
  patch: UpdateHighlightRequest,
  authenticated: boolean,
): Promise<Highlight> {
  if (authenticated) {
    return apiFetch<Highlight>(`/api/highlights/${highlight.id}`, { method: "PATCH", body: JSON.stringify(patch) });
  }
  const updated: Highlight = {
    ...highlight,
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    // Prompt edits go through saveHighlightPrompt, but this handles one in a
    // feedback patch too: the authenticated branch above forwards the whole
    // patch to the API, so a caller that sent one would have it saved when
    // signed in and silently dropped when signed out -- the exact asymmetry
    // that makes local mode untrustworthy. normalizeRecallPrompt matches
    // every other writer (see packages/shared/src/recall-prompt.ts).
    ...(patch.prompt !== undefined ? { prompt: normalizeRecallPrompt(patch.prompt) } : {}),
    ...(patch.resurfaceArchivedAt !== undefined ? { resurfaceArchivedAt: patch.resurfaceArchivedAt } : {}),
    ...(patch.lastSurfacedAt !== undefined ? { lastSurfacedAt: patch.lastSurfacedAt } : {}),
    ...(patch.surfaceCount !== undefined ? { surfaceCount: patch.surfaceCount } : {}),
    ...(patch.lastFeedback !== undefined ? { lastFeedback: patch.lastFeedback } : {}),
    ...(patch.lastFeedbackAt !== undefined ? { lastFeedbackAt: patch.lastFeedbackAt } : {}),
    ...(patch.easinessFactor !== undefined ? { easinessFactor: patch.easinessFactor } : {}),
    ...(patch.intervalDays !== undefined ? { intervalDays: patch.intervalDays } : {}),
    ...(patch.repetitions !== undefined ? { repetitions: patch.repetitions } : {}),
    ...(patch.nextDueAt !== undefined ? { nextDueAt: patch.nextDueAt } : {}),
    updatedAt: new Date().toISOString(),
  };
  await localHighlights.put(updated);
  return updated;
}
