/**
 * IndexedDB-backed local storage for articles and highlights -- this is what
 * makes Booklet fully usable without an account. Signing in doesn't replace
 * this; it adds a synced copy on the server (see lib/data/*) while this
 * stays the source of truth for anyone who never creates an account.
 */
import type { Article, Collection, Feed, Highlight } from "@booklet/shared";

const DB_NAME = "booklet";
// Bumped 4 -> 5: some browsers ended up with a v4 database that never got
// the `feeds` store created (IDBDatabase.transaction: 'feeds' is not a
// known object store name -- onupgradeneeded only re-runs when the
// requested version is actually higher than what's already stored, so a
// browser already sitting at 4 never re-ran this block once feeds was
// added to it). Bumping the version forces that upgrade to run for
// everyone; the `if (!contains(...))` guards below mean this only adds
// what's missing, never touches existing data in any other store.
const DB_VERSION = 5;
const ARTICLES_STORE = "articles";
const HIGHLIGHTS_STORE = "highlights";
const COLLECTIONS_STORE = "collections";
const ARTICLE_COLLECTIONS_STORE = "articleCollections";
const FILES_STORE = "files";
const FEEDS_STORE = "feeds";

interface LocalFile {
  id: string; // articleId
  blob: Blob;
}

export interface LocalArticleCollection {
  id: string; // `${articleId}:${collectionId}`
  articleId: string;
  collectionId: string;
  addedAt: string;
}

function isBrowser(): boolean {
  return typeof indexedDB !== "undefined";
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!isBrowser()) return Promise.reject(new Error("IndexedDB is not available in this environment."));
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ARTICLES_STORE)) {
        db.createObjectStore(ARTICLES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(HIGHLIGHTS_STORE)) {
        const store = db.createObjectStore(HIGHLIGHTS_STORE, { keyPath: "id" });
        store.createIndex("articleId", "articleId");
      }
      if (!db.objectStoreNames.contains(COLLECTIONS_STORE)) {
        db.createObjectStore(COLLECTIONS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(ARTICLE_COLLECTIONS_STORE)) {
        const store = db.createObjectStore(ARTICLE_COLLECTIONS_STORE, { keyPath: "id" });
        store.createIndex("articleId", "articleId");
        store.createIndex("collectionId", "collectionId");
      }
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FEEDS_STORE)) {
        db.createObjectStore(FEEDS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  if (!isBrowser()) return [];
  const db = await openDb();
  const store = db.transaction(storeName, "readonly").objectStore(storeName);
  return promisify(store.getAll());
}

async function getOne<T>(storeName: string, id: string): Promise<T | undefined> {
  if (!isBrowser()) return undefined;
  const db = await openDb();
  const store = db.transaction(storeName, "readonly").objectStore(storeName);
  return promisify(store.get(id));
}

async function put(storeName: string, value: unknown): Promise<void> {
  const db = await openDb();
  const store = db.transaction(storeName, "readwrite").objectStore(storeName);
  await promisify(store.put(value));
}

async function remove(storeName: string, id: string): Promise<void> {
  const db = await openDb();
  const store = db.transaction(storeName, "readwrite").objectStore(storeName);
  await promisify(store.delete(id));
}

async function clear(storeName: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  const store = db.transaction(storeName, "readwrite").objectStore(storeName);
  await promisify(store.clear());
}

async function getAllByIndex<T>(storeName: string, indexName: string, value: string): Promise<T[]> {
  if (!isBrowser()) return [];
  const db = await openDb();
  const store = db.transaction(storeName, "readonly").objectStore(storeName);
  return promisify(store.index(indexName).getAll(value));
}

/** Records saved before `tags`/`favorited`/`activeReadingSeconds` existed
 * predate them in IndexedDB -- there's no migration path for existing
 * records, only for object stores, so old rows are missing fields added
 * since. Normalize on read instead. */
function normalizeArticle(article: Article): Article {
  return {
    ...article,
    tags: article.tags ?? [],
    favorited: article.favorited ?? false,
    activeReadingSeconds: article.activeReadingSeconds ?? 0,
    canonicalUrl: article.canonicalUrl ?? null,
    textSource: article.textSource ?? null,
  };
}

const TRASH_RETENTION_DAYS = 30;

/** Mirrors the server's purgeExpiredTrash (articles.ts) -- no background
 * worker here either, so this runs lazily whenever the trash view itself is
 * read rather than on a schedule. */
async function purgeExpiredLocalTrash(): Promise<void> {
  const all = await getAll<Article>(ARTICLES_STORE);
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expired = all.filter((a) => a.deletedAt && new Date(a.deletedAt).getTime() < cutoff);
  await Promise.all(expired.map((a) => Promise.all([remove(ARTICLES_STORE, a.id), remove(FILES_STORE, a.id)])));
}

export const localArticles = {
  // Trash is excluded from the normal list regardless of status, same as
  // the server -- see getTrash() for the dedicated trash view.
  getAll: () =>
    getAll<Article>(ARTICLES_STORE).then((articles) => articles.map(normalizeArticle).filter((a) => !a.deletedAt)),
  getTrash: () =>
    purgeExpiredLocalTrash().then(() =>
      getAll<Article>(ARTICLES_STORE).then((articles) => articles.map(normalizeArticle).filter((a) => !!a.deletedAt)),
    ),
  get: (id: string) => getOne<Article>(ARTICLES_STORE, id).then((a) => (a ? normalizeArticle(a) : a)),
  put: (article: Article) => put(ARTICLES_STORE, article),
  delete: (id: string) => remove(ARTICLES_STORE, id),
  clear: () => clear(ARTICLES_STORE),
};

export const localHighlights = {
  getAll: () => getAll<Highlight>(HIGHLIGHTS_STORE),
  put: (highlight: Highlight) => put(HIGHLIGHTS_STORE, highlight),
  delete: (id: string) => remove(HIGHLIGHTS_STORE, id),
  clear: () => clear(HIGHLIGHTS_STORE),
};

/** Same reasoning as normalizeArticle above -- records saved before
 * filter/parentId existed predate them in IndexedDB. */
function normalizeCollection(collection: Collection): Collection {
  return {
    ...collection,
    filter: collection.filter ?? null,
    parentId: collection.parentId ?? null,
  };
}

export const localCollections = {
  getAll: () => getAll<Collection>(COLLECTIONS_STORE).then((rows) => rows.map(normalizeCollection)),
  put: (collection: Collection) => put(COLLECTIONS_STORE, collection),
  delete: (id: string) => remove(COLLECTIONS_STORE, id),
  clear: () => clear(COLLECTIONS_STORE),
};

export const localFeeds = {
  getAll: () => getAll<Feed>(FEEDS_STORE),
  put: (feed: Feed) => put(FEEDS_STORE, feed),
  delete: (id: string) => remove(FEEDS_STORE, id),
  clear: () => clear(FEEDS_STORE),
};

export const localFiles = {
  get: (articleId: string) => getOne<LocalFile>(FILES_STORE, articleId),
  put: (articleId: string, blob: Blob) => put(FILES_STORE, { id: articleId, blob } satisfies LocalFile),
  delete: (articleId: string) => remove(FILES_STORE, articleId),
  clear: () => clear(FILES_STORE),
};

export const localArticleCollections = {
  getForArticle: (articleId: string) =>
    getAllByIndex<LocalArticleCollection>(ARTICLE_COLLECTIONS_STORE, "articleId", articleId),
  getForCollection: (collectionId: string) =>
    getAllByIndex<LocalArticleCollection>(ARTICLE_COLLECTIONS_STORE, "collectionId", collectionId),
  put: (link: LocalArticleCollection) => put(ARTICLE_COLLECTIONS_STORE, link),
  delete: (id: string) => remove(ARTICLE_COLLECTIONS_STORE, id),
  deleteForCollection: async (collectionId: string) => {
    const links = await getAllByIndex<LocalArticleCollection>(ARTICLE_COLLECTIONS_STORE, "collectionId", collectionId);
    await Promise.all(links.map((l) => remove(ARTICLE_COLLECTIONS_STORE, l.id)));
  },
  clear: () => clear(ARTICLE_COLLECTIONS_STORE),
};
