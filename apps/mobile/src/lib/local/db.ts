/**
 * AsyncStorage-backed local storage for articles and highlights -- the
 * mobile equivalent of the web app's lib/local/db.ts (IndexedDB). Same
 * principle: this is what makes the app usable without an account, and
 * stays the source of truth for anyone who never signs in. AsyncStorage is
 * a flat key/value store (no indexes, no transactions), so each entity
 * type is kept as a single JSON-encoded map of id -> record rather than
 * IndexedDB's per-row storage.
 *
 * That single-map shape is also why deleting several records needs
 * deleteMany() rather than a Promise.all of delete() calls -- see the note
 * on localArticles.deleteMany.
 *
 * One thing the web layer has and this one does not: normalize-on-read
 * (normalizeArticle / normalizeCollection there). Those exist because that
 * store has shipped and holds rows written before fields like `tags`,
 * `canonicalUrl` and `textSource` existed, which TypeScript believes are
 * present and which are not. Nothing on a device has ever written to this
 * store -- see the repo's #1/#2, no build has been run on real hardware --
 * so there is no old shape to normalize *yet*. The first release changes
 * that: anything added to Article, Collection or Highlight after it ships
 * needs a normalizer here, or reads will hand out records with undefined
 * where a number or an array is declared.
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
  /**
   * One read-modify-write for the whole set, and the only safe way to remove
   * more than one record here. Every entity type is a single JSON-encoded
   * map under one key (AsyncStorage has no transactions), so N concurrent
   * single-id deletes each read the *same* map, remove their own id, and
   * write the whole thing back -- last writer wins and every other deletion
   * is silently undone. The migration in data/sync.ts clears a batch of
   * articles at once, which is exactly that shape.
   */
  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const map = await readMap<Article>(ARTICLES_KEY);
    for (const id of ids) delete map[id];
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
  /** See localArticles.deleteMany -- same lost-update hazard, same fix. */
  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const map = await readMap<Highlight>(HIGHLIGHTS_KEY);
    for (const id of ids) delete map[id];
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
  // No delete(): there is no delete-collection control on any mobile screen
  // (see data/collections.ts), and an unreachable one here would also need
  // the web app's cascade -- reparent the children, drop the join rows --
  // which is real behaviour nothing would be exercising.
  async clear(): Promise<void> {
    await AsyncStorage.removeItem(COLLECTIONS_KEY);
  },
};

export const localArticleCollections = {
  async getAll(): Promise<LocalArticleCollection[]> {
    return Object.values(await readMap<LocalArticleCollection>(ARTICLE_COLLECTIONS_KEY));
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
