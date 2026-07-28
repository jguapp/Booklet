import type { ArticleSummary, Collection, CreateCollectionRequest, UpdateCollectionRequest } from "@booklet/shared";
import { apiFetch, ApiError } from "@/lib/api/client";
import { localArticleCollections, localArticles, localCollections } from "@/lib/local/db";

export { ApiError };

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

export async function createCollection(input: CreateCollectionRequest, authenticated: boolean): Promise<Collection> {
  if (authenticated) {
    return apiFetch<Collection>("/api/collections", { method: "POST", body: JSON.stringify(input) });
  }

  const name = input.name.trim();
  const existing = (await localCollections.getAll()).find((c) => c.name === name);
  if (existing) {
    throw new ApiError(409, "already_exists", "You already have a collection with that name.");
  }

  const now = new Date().toISOString();
  const collection: Collection = {
    id: crypto.randomUUID(),
    userId: "local",
    name,
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
    articleCount: 0,
  };
  await localCollections.put(collection);
  return collection;
}

export async function updateCollection(
  id: string,
  input: UpdateCollectionRequest,
  authenticated: boolean,
): Promise<Collection> {
  if (authenticated) {
    return apiFetch<Collection>(`/api/collections/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  }
  const existing = (await localCollections.getAll()).find((c) => c.id === id);
  if (!existing) throw new ApiError(404, "not_found", "Collection not found.");
  const updated: Collection = {
    ...existing,
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    updatedAt: new Date().toISOString(),
  };
  await localCollections.put(updated);
  return updated;
}

export async function deleteCollection(id: string, authenticated: boolean): Promise<void> {
  if (authenticated) {
    await apiFetch(`/api/collections/${id}`, { method: "DELETE" });
    return;
  }
  await localArticleCollections.deleteForCollection(id);
  await localCollections.delete(id);
}

export async function loadCollectionsForArticle(articleId: string, authenticated: boolean): Promise<Collection[]> {
  if (authenticated) return apiFetch<Collection[]>(`/api/articles/${articleId}/collections`);

  const links = await localArticleCollections.getForArticle(articleId);
  const all = await localCollections.getAll();
  const byId = new Map(all.map((c) => [c.id, c]));
  return links.map((l) => byId.get(l.collectionId)).filter((c): c is Collection => !!c);
}

export async function loadArticlesInCollection(
  collectionId: string,
  authenticated: boolean,
): Promise<ArticleSummary[]> {
  if (authenticated) return apiFetch<ArticleSummary[]>(`/api/collections/${collectionId}/articles`);

  const links = await localArticleCollections.getForCollection(collectionId);
  const articleIds = new Set(links.map((l) => l.articleId));
  const all = await localArticles.getAll();
  return all.filter((a) => articleIds.has(a.id));
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
