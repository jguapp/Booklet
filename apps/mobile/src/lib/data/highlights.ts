/**
 * The local-vs-synced swap point for highlights -- mirrors the web app's
 * lib/data/highlights.ts, scoped to what the mobile reader actually does
 * (create/list/delete while reading). No notes/annotations or resurfacing
 * feedback UI on mobile yet, so those parts of the web version aren't
 * ported here.
 */
import type { Highlight, HighlightColor, HighlightPosition } from "@booklet/shared";
import { DEFAULT_SM2_STATE } from "@booklet/shared";
import { apiFetch, ApiError } from "../api";
import { generateLocalId, localHighlights } from "../local/db";

export { ApiError };

export async function loadHighlights(articleId: string, authenticated: boolean): Promise<Highlight[]> {
  if (authenticated) {
    return apiFetch<Highlight[]>(`/api/highlights?articleId=${encodeURIComponent(articleId)}`);
  }
  return localHighlights.getForArticle(articleId);
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
