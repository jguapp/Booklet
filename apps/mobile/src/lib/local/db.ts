/**
 * AsyncStorage-backed local storage for articles and highlights -- the
 * mobile equivalent of the web app's lib/local/db.ts (IndexedDB). Same
 * principle: this is what makes the app usable without an account, and
 * stays the source of truth for anyone who never signs in. AsyncStorage is
 * a flat key/value store (no indexes, no transactions), so each entity
 * type is kept as a single JSON-encoded map of id -> record rather than
 * IndexedDB's per-row storage.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Article, Collection, Highlight } from "@booklet/shared";

const ARTICLES_KEY = "booklet_local_articles";
const HIGHLIGHTS_KEY = "booklet_local_highlights";
const COLLECTIONS_KEY = "booklet_local_collections";
const ARTICLE_COLLECTIONS_KEY = "booklet_local_article_collections";

export interface LocalArticleCollection {
  id: string; // `${articleId}:${collectionId}`
  articleId: string;
  collectionId: string;
  addedAt: string;
}

// Hermes (React Native's JS engine) doesn't implement crypto.randomUUID()
// without an extra native module (expo-crypto) -- not worth a new
// dependency just for locally-scoped ids that are never treated as
// server-issued UUIDs.
export function generateLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readMap<T>(key: string): Promise<Record<string, T>> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, T>;
  } catch {
    return {};
  }
}

async function writeMap<T>(key: string, map: Record<string, T>): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(map));
}

export const localArticles = {
  async getAll(): Promise<Article[]> {
    return Object.values(await readMap<Article>(ARTICLES_KEY));
  },
  async get(id: string): Promise<Article | undefined> {
    return (await readMap<Article>(ARTICLES_KEY))[id];
  },
  async put(article: Article): Promise<void> {
    const map = await readMap<Article>(ARTICLES_KEY);
    map[article.id] = article;
    await writeMap(ARTICLES_KEY, map);
  },
  async delete(id: string): Promise<void> {
    const map = await readMap<Article>(ARTICLES_KEY);
    delete map[id];
    await writeMap(ARTICLES_KEY, map);
  },
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(ARTICLES_KEY);
  },
};

export const localHighlights = {
  async getAll(): Promise<Highlight[]> {
    return Object.values(await readMap<Highlight>(HIGHLIGHTS_KEY));
  },
  async getForArticle(articleId: string): Promise<Highlight[]> {
    return (await this.getAll()).filter((h) => h.articleId === articleId);
  },
  async put(highlight: Highlight): Promise<void> {
    const map = await readMap<Highlight>(HIGHLIGHTS_KEY);
    map[highlight.id] = highlight;
    await writeMap(HIGHLIGHTS_KEY, map);
  },
  async delete(id: string): Promise<void> {
    const map = await readMap<Highlight>(HIGHLIGHTS_KEY);
    delete map[id];
    await writeMap(HIGHLIGHTS_KEY, map);
  },
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(HIGHLIGHTS_KEY);
  },
};

export const localCollections = {
  async getAll(): Promise<Collection[]> {
    return Object.values(await readMap<Collection>(COLLECTIONS_KEY));
  },
  async put(collection: Collection): Promise<void> {
    const map = await readMap<Collection>(COLLECTIONS_KEY);
    map[collection.id] = collection;
    await writeMap(COLLECTIONS_KEY, map);
  },
  async delete(id: string): Promise<void> {
    const map = await readMap<Collection>(COLLECTIONS_KEY);
    delete map[id];
    await writeMap(COLLECTIONS_KEY, map);
  },
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(COLLECTIONS_KEY);
  },
};

export const localArticleCollections = {
  async getAll(): Promise<LocalArticleCollection[]> {
    return Object.values(await readMap<LocalArticleCollection>(ARTICLE_COLLECTIONS_KEY));
  },
  async getForArticle(articleId: string): Promise<LocalArticleCollection[]> {
    return (await this.getAll()).filter((l) => l.articleId === articleId);
  },
  async getForCollection(collectionId: string): Promise<LocalArticleCollection[]> {
    return (await this.getAll()).filter((l) => l.collectionId === collectionId);
  },
  async put(link: LocalArticleCollection): Promise<void> {
    const map = await readMap<LocalArticleCollection>(ARTICLE_COLLECTIONS_KEY);
    map[link.id] = link;
    await writeMap(ARTICLE_COLLECTIONS_KEY, map);
  },
  async delete(id: string): Promise<void> {
    const map = await readMap<LocalArticleCollection>(ARTICLE_COLLECTIONS_KEY);
    delete map[id];
    await writeMap(ARTICLE_COLLECTIONS_KEY, map);
  },
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(ARTICLE_COLLECTIONS_KEY);
  },
};
