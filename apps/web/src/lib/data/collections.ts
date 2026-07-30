import type { ArticleSummary, Collection, CreateCollectionRequest, UpdateCollectionRequest } from "@booklet/shared";
import { matchesCollectionFilter } from "@booklet/shared";
import { apiFetch, ApiError } from "@/lib/api/client";
import { localArticleCollections, localArticles, localCollections } from "@/lib/local/db";

export async function loadCollections(authenticated: boolean): Promise<Collection[]> {
  if (authenticated) return apiFetch<Collection[]>("/api/collections");

  const collections = await localCollections.getAll();
  const allArticles = await localArticles.getAll();
  const withCounts = await Promise.all(
    collections.map(async (c) => ({
      ...c,
      articleCount: c.filter
        ? allArticles.filter((a) => matchesCollectionFilter(a, c.filter!)).length
        : (await localArticleCollections.getForCollection(c.id)).length,
    })),
  );
  return withCounts.sort((a, b) => a.name.localeCompare(b.name));
}

/** True if `candidateId` is `ancestorId` itself or a descendant of it --
 * mirrors the API's own wouldCreateCycle (collections.ts) for local mode. */
async function localWouldCreateCycle(ancestorId: string, candidateId: string): Promise<boolean> {
  const all = await localCollections.getAll();
  const byId = new Map(all.map((c) => [c.id, c]));
  let cursor: string | null = candidateId;
  while (cursor) {
    if (cursor === ancestorId) return true;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
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
    filter: input.filter ?? null,
    parentId: input.parentId ?? null,
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

  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === existing.id) {
      throw new ApiError(400, "invalid_parent", "A collection can't contain itself.");
    }
    const parentExists = (await localCollections.getAll()).some((c) => c.id === input.parentId);
    if (!parentExists) throw new ApiError(404, "not_found", "Parent collection not found.");
    if (await localWouldCreateCycle(existing.id, input.parentId)) {
      throw new ApiError(400, "invalid_parent", "That would nest a collection inside its own descendant.");
    }
  }

  const updated: Collection = {
    ...existing,
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
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
  // Children become top-level rather than being deleted too, matching the
  // API's onDelete: SetNull.
  const children = (await localCollections.getAll()).filter((c) => c.parentId === id);
  await Promise.all(children.map((c) => localCollections.put({ ...c, parentId: null })));
  await localArticleCollections.deleteForCollection(id);
  await localCollections.delete(id);
}

export async function loadCollectionsForArticle(articleId: string, authenticated: boolean): Promise<Collection[]> {
  if (authenticated) return apiFetch<Collection[]>(`/api/articles/${articleId}/collections`);

  const links = await localArticleCollections.getForArticle(articleId);
  const all = await localCollections.getAll();
  return links.map((l) => all.find((c) => c.id === l.collectionId)).filter((c): c is Collection => !!c);
}

export async function loadArticlesInCollection(
  collectionId: string,
  authenticated: boolean,
): Promise<ArticleSummary[]> {
  if (authenticated) return apiFetch<ArticleSummary[]>(`/api/collections/${collectionId}/articles`);

  const collection = (await localCollections.getAll()).find((c) => c.id === collectionId);
  const all = await localArticles.getAll();
  if (collection?.filter) {
    return all
      .filter((a) => matchesCollectionFilter(a, collection.filter!))
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  }

  const links = await localArticleCollections.getForCollection(collectionId);
  const articleIds = new Set(links.map((l) => l.articleId));
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
  const collection = (await localCollections.getAll()).find((c) => c.id === collectionId);
  if (collection?.filter) {
    throw new ApiError(400, "smart_collection", "This collection's contents are computed from its filter.");
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
