/**
 * The local-vs-synced swap point for highlights -- mirrors the web app's
 * lib/data/highlights.ts, scoped to what the mobile reader and Daily
 * Review screen actually do (create/list/delete while reading, list-all +
 * feedback for resurfacing).
 *
 * Deliberately absent, because no screen here has the control that would
 * call them: saveNote / deleteNote (no annotations UI) and
 * saveHighlightPrompt (no prompt-authoring UI, #157). Prompts written on the
 * web still sync down and are honored by DailyReviewScreen's reveal step, so
 * the feature is read-only here rather than missing. updateHighlightFeedback
 * below still applies a `prompt` in its patch if one ever arrives -- see the
 * comment there.
 */
import type { Highlight, HighlightColor, HighlightPosition, UpdateHighlightRequest } from "@booklet/shared";
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
    // No prompt-authoring UI on mobile yet -- prompts written on the web sync
    // down and are honored by DailyReviewScreen's reveal step all the same.
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
    // Handled even though no mobile screen writes a prompt yet. The
    // authenticated branch above forwards the whole patch to the API, so a
    // caller that sent one would have it saved when signed in and silently
    // dropped when signed out -- the exact asymmetry that makes local mode
    // untrustworthy. normalizeRecallPrompt matches every other writer
    // (see packages/shared/src/recall-prompt.ts).
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
