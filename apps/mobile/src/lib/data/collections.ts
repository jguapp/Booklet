/**
 * The local-vs-synced swap point for collections -- mirrors the web app's
 * lib/data/collections.ts, scoped to what the mobile Library screen
 * actually does (filter by one collection at a time, create, toggle a
 * single article's membership in the currently-viewed collection). No
 * rename/delete/color UI on mobile yet.
 */
import type { Collection } from "@booklet/shared";
import { apiFetch, ApiError } from "../api";
import { generateLocalId, localArticleCollections, localCollections } from "../local/db";

export async function loadCollections(authenticated: boolean): Promise<Collection[]> {
  if (authenticated) return apiFetch<Collection[]>("/api/collections");

  const collections = await localCollections.getAll();
  const withCounts = await Promise.all(
    collections.map(async (c) => ({
      ...c,
      articleCount: (await localArticleCollections.getForCollection(c.id)).length,
    })),
  );
  return withCounts.sort((a, b) => a.name.localeCompare(b.name));
}

export async function createCollection(name: string, authenticated: boolean): Promise<Collection> {
  const trimmed = name.trim();
  if (authenticated) {
    return apiFetch<Collection>("/api/collections", { method: "POST", body: JSON.stringify({ name: trimmed }) });
  }
  const existing = (await localCollections.getAll()).find((c) => c.name === trimmed);
  if (existing) throw new ApiError(409, "already_exists", "You already have a collection with that name.");

  const now = new Date().toISOString();
  const collection: Collection = {
    id: generateLocalId(),
    userId: "local",
    name: trimmed,
    color: null,
    filter: null,
    parentId: null,
    createdAt: now,
    updatedAt: now,
    articleCount: 0,
  };
  await localCollections.put(collection);
  return collection;
}

export async function loadArticleIdsInCollection(collectionId: string, authenticated: boolean): Promise<Set<string>> {
  if (authenticated) {
    const articles = await apiFetch<{ id: string }[]>(`/api/collections/${collectionId}/articles`);
    return new Set(articles.map((a) => a.id));
  }
  const links = await localArticleCollections.getForCollection(collectionId);
  return new Set(links.map((l) => l.articleId));
}

export async function addArticleToCollection(
  articleId: string,
  collectionId: string,
  authenticated: boolean,
): Promise<void> {
  if (authenticated) {
    await apiFetch(`/api/collections/${collectionId}/articles/${articleId}`, { method: "PUT" });
    return;
  }
  await localArticleCollections.put({
    id: `${articleId}:${collectionId}`,
    articleId,
    collectionId,
    addedAt: new Date().toISOString(),
  });
}

export async function removeArticleFromCollection(
  articleId: string,
  collectionId: string,
  authenticated: boolean,
): Promise<void> {
  if (authenticated) {
    await apiFetch(`/api/collections/${collectionId}/articles/${articleId}`, { method: "DELETE" });
    return;
  }
  await localArticleCollections.delete(`${articleId}:${collectionId}`);
}
