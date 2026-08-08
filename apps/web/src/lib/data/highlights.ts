/**
 * The local-vs-synced swap point for highlights and their notes, same shape
 * as lib/data/articles.ts. Operation-based (create/delete/patch) rather than
 * whole-array-replace, since that's what the highlights API actually looks
 * like -- local mode mirrors the same shape so callers don't care which one
 * they're talking to.
 */
import type {
  CreateHighlightRequest,
  Highlight,
  HighlightColor,
  HighlightPosition,
  UpdateHighlightRequest,
} from "@booklet/shared";
import { DEFAULT_SM2_STATE, normalizeRecallPrompt } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";
import { localHighlights } from "@/lib/local/db";

const LOCAL_USER_ID = "local";

export async function loadHighlights(authenticated: boolean, articleId?: string): Promise<Highlight[]> {
  if (authenticated) {
    const params = articleId ? `?articleId=${encodeURIComponent(articleId)}` : "";
    return apiFetch<Highlight[]>(`/api/highlights${params}`);
  }
  const all = await localHighlights.getAll();
  return articleId ? all.filter((h) => h.articleId === articleId) : all;
}

interface CreateHighlightInput {
  articleId: string;
  selectedText: string;
  position: HighlightPosition;
  color: HighlightColor;
  noteText?: string;
  prompt?: string | null;
}

export async function createHighlight(input: CreateHighlightInput, authenticated: boolean): Promise<Highlight> {
  if (authenticated) {
    const body: CreateHighlightRequest = input;
    return apiFetch<Highlight>("/api/highlights", { method: "POST", body: JSON.stringify(body) });
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const trimmedNote = input.noteText?.trim();
  const highlight: Highlight = {
    id,
    articleId: input.articleId,
    userId: LOCAL_USER_ID,
    selectedText: input.selectedText,
    position: input.position,
    color: input.color,
    prompt: normalizeRecallPrompt(input.prompt),
    lastSurfacedAt: null,
    surfaceCount: 0,
    lastFeedback: null,
    lastFeedbackAt: null,
    resurfaceArchivedAt: null,
    ...DEFAULT_SM2_STATE,
    nextDueAt: null,
    createdAt: now,
    updatedAt: now,
    annotation: trimmedNote
      ? {
          id: crypto.randomUUID(),
          highlightId: id,
          userId: LOCAL_USER_ID,
          noteText: trimmedNote,
          createdAt: now,
          updatedAt: now,
        }
      : null,
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
  const updated: Highlight = {
    ...highlight,
    annotation: highlight.annotation
      ? { ...highlight.annotation, noteText, updatedAt: now }
      : {
          id: crypto.randomUUID(),
          highlightId: highlight.id,
          userId: LOCAL_USER_ID,
          noteText,
          createdAt: now,
          updatedAt: now,
        },
  };
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
 * than a call into updateHighlightFeedback below, which is named for what it
 * does -- writing a prompt is an edit, not a review judgment, and routing it
 * through "feedback" would read like one at every call site.
 *
 * Passing null (or an emptied textarea) removes the prompt, which is what
 * puts the highlight back on the plain show-then-grade path.
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
    return apiFetch<Highlight>(`/api/highlights/${highlight.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }
  const updated: Highlight = {
    ...highlight,
    ...(patch.color !== undefined ? { color: patch.color } : {}),
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
