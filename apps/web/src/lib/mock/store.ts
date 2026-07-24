import type { Article, Highlight, ResurfaceFrequency } from "@booklet/shared";
import { mockUser, seedArticles, seedHighlights } from "./data";

/**
 * Stand-in for the real API until Auth/save/highlight/settings routes exist
 * (see the "frontend-only, mock data" decisions made throughout this
 * project). Swap this module out, not the pages that call it, once a real
 * backend lands. Bump a key whenever the shape it stores changes -- a
 * browser holding data from before a schema change must not be handed to
 * code expecting the new shape.
 */

const ARTICLES_KEY = "booklet-mock-articles-v1";
const HIGHLIGHTS_KEY = "booklet-mock-highlights-v2";
const SETTINGS_KEY = "booklet-mock-settings-v1";

export interface UserSettings {
  resurfaceFrequency: ResurfaceFrequency;
  highlightsPerDigest: number;
}

function load<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort only
  }
}

function looksLikeArticleArray(value: unknown): value is Article[] {
  return (
    Array.isArray(value) &&
    value.every((a) => typeof a === "object" && a !== null && typeof (a as Record<string, unknown>).id === "string")
  );
}

function looksLikeHighlightArray(value: unknown): value is Highlight[] {
  return (
    Array.isArray(value) &&
    value.every((h) => {
      if (typeof h !== "object" || h === null) return false;
      const v = h as Record<string, unknown>;
      return (
        typeof v.id === "string" &&
        typeof v.position === "object" &&
        v.position !== null &&
        typeof (v.position as Record<string, unknown>).type === "string"
      );
    })
  );
}

function looksLikeSettings(value: unknown): value is UserSettings {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.resurfaceFrequency === "DAILY" || v.resurfaceFrequency === "WEEKLY") &&
    typeof v.highlightsPerDigest === "number"
  );
}

export function loadArticles(): Article[] {
  return load(ARTICLES_KEY, seedArticles, looksLikeArticleArray);
}

export function saveArticles(articles: Article[]): void {
  save(ARTICLES_KEY, articles);
}

export function loadHighlights(): Highlight[] {
  return load(HIGHLIGHTS_KEY, seedHighlights, looksLikeHighlightArray);
}

export function saveHighlights(highlights: Highlight[]): void {
  save(HIGHLIGHTS_KEY, highlights);
}

export function loadUserSettings(): UserSettings {
  return load(
    SETTINGS_KEY,
    { resurfaceFrequency: mockUser.resurfaceFrequency, highlightsPerDigest: mockUser.highlightsPerDigest },
    looksLikeSettings,
  );
}

export function saveUserSettings(settings: UserSettings): void {
  save(SETTINGS_KEY, settings);
}
