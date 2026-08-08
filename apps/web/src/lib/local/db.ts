/**
 * IndexedDB-backed local storage for articles and highlights -- this is what
 * makes Booklet fully usable without an account. Signing in doesn't replace
 * this; it adds a synced copy on the server (see lib/data/*) while this
 * stays the source of truth for anyone who never creates an account.
 */
import type { Article, Collection, Feed, Highlight } from "@booklet/shared";
import { DEFAULT_SM2_STATE } from "@booklet/shared";

const DB_NAME = "booklet";
// Bumped 4 -> 5: some browsers ended up with a v4 database that never got
// the `feeds` store created (IDBDatabase.transaction: 'feeds' is not a
// known object store name -- onupgradeneeded only re-runs when the
// requested version is actually higher than what's already stored, so a
// browser already sitting at 4 never re-ran this block once feeds was
// added to it). Bumping the version forces that upgrade to run for
// everyone; the `if (!contains(...))` guards below mean this only adds
// what's missing, never touches existing data in any other store.
// Bumped 5 -> 6 to add `embeddings` for local semantic search (#156). Same
// additive shape as every bump before it: the guards below only create what
// is missing, so no existing store is touched.
const DB_VERSION = 6;
const ARTICLES_STORE = "articles";
const HIGHLIGHTS_STORE = "highlights";
const COLLECTIONS_STORE = "collections";
const ARTICLE_COLLECTIONS_STORE = "articleCollections";
const FILES_STORE = "files";
const FEEDS_STORE = "feeds";
const EMBEDDINGS_STORE = "embeddings";

interface LocalFile {
  id: string; // articleId
  blob: Blob;
}

/**
 * One record per article rather than one per chunk (#156).
 *
 * The server splits chunks into rows because SQL wants them that way; here
 * the whole set is written and replaced as a unit, which is what makes a
 * re-index atomic without needing a transaction spanning many keys -- an
 * article can never be left indexed by a mixture of two versions of its text.
 *
 * `textHash` is what makes rebuilding incremental: an article whose text has
 * not changed is skipped, so re-opening the app does not re-embed a library
 * that is already done.
 *
 * Vectors stay Float32Array, not number[]. IndexedDB's structured clone
 * stores typed arrays natively, so this is ~4 bytes per dimension instead of
 * ~8 plus per-element array overhead -- across a real library that is the
 * difference between tens and hundreds of megabytes.
 */
export interface LocalArticleEmbedding {
  id: string; // articleId
  textHash: string;
  vectors: Float32Array[];
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
      if (!db.objectStoreNames.contains(EMBEDDINGS_STORE)) {
        db.createObjectStore(EMBEDDINGS_STORE, { keyPath: "id" });
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

/**
 * Resolves when the transaction has actually committed, not when its request
 * reported success (#168).
 *
 * Those are not the same moment, and the gap is where writes went missing. A
 * request's `onsuccess` fires as soon as the operation succeeds *within* the
 * transaction; the data is not durable until `oncomplete`. Awaiting the
 * request therefore returns while the write is still only pending, and
 * anything that tears the page down in between -- a navigation, a reload,
 * closing the tab -- takes the uncommitted transaction with it.
 *
 * That is not theoretical: marking an article Reading and immediately
 * navigating lost the status on 4 of 5 runs, which had been read as a flaky
 * test rather than a lost write. Every local-mode write goes through here --
 * status, tags, favorites, reading progress, highlights, collections -- so
 * the same race applied to all of them.
 *
 * Reads are unaffected and still await the request: their result is available
 * at `onsuccess` and there is nothing to make durable.
 */
function commit(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
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
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await commit(tx);
}

async function remove(storeName: string, id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(id);
  await commit(tx);
}

async function clear(storeName: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).clear();
  await commit(tx);
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
    // Anything saved before #152 has no listening fields at all. Backfilling
    // to null rather than leaving them undefined keeps "never listened" a
    // single representable value -- the resume check tests for null, and an
    // undefined slipping through would read as a position of NaN downstream.
    listeningFraction: article.listeningFraction ?? null,
    listeningUpdatedAt: article.listeningUpdatedAt ?? null,
    listeningDeviceId: article.listeningDeviceId ?? null,
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

/**
 * Same reasoning as normalizeArticle above, and the same reason it exists:
 * IndexedDB migrates object stores, never the rows inside them, so a
 * highlight saved before recall prompts and SM-2 scheduling existed is
 * missing every field they added.
 *
 * Articles and collections were normalized on read; highlights were not, and
 * they are the ones where a missing field is more than cosmetic. An
 * undefined easinessFactor goes straight into applySm2Review as an operand
 * (see the resurface page) and every interval it computes from there is NaN
 * -- which becomes an Invalid Date nextDueAt, written back, and a highlight
 * whose review schedule can never recover. Filling the documented defaults
 * in on read costs nothing and cannot produce that.
 */
function normalizeHighlight(highlight: Highlight): Highlight {
  return {
    ...highlight,
    prompt: highlight.prompt ?? null,
    lastSurfacedAt: highlight.lastSurfacedAt ?? null,
    surfaceCount: highlight.surfaceCount ?? 0,
    lastFeedback: highlight.lastFeedback ?? null,
    lastFeedbackAt: highlight.lastFeedbackAt ?? null,
    resurfaceArchivedAt: highlight.resurfaceArchivedAt ?? null,
    easinessFactor: highlight.easinessFactor ?? DEFAULT_SM2_STATE.easinessFactor,
    intervalDays: highlight.intervalDays ?? DEFAULT_SM2_STATE.intervalDays,
    repetitions: highlight.repetitions ?? DEFAULT_SM2_STATE.repetitions,
    nextDueAt: highlight.nextDueAt ?? null,
    annotation: highlight.annotation ?? null,
  };
}

export const localHighlights = {
  getAll: () => getAll<Highlight>(HIGHLIGHTS_STORE).then((rows) => rows.map(normalizeHighlight)),
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

export const localEmbeddings = {
  getAll: () => getAll<LocalArticleEmbedding>(EMBEDDINGS_STORE),
  get: (articleId: string) => getOne<LocalArticleEmbedding>(EMBEDDINGS_STORE, articleId),
  put: (record: LocalArticleEmbedding) => put(EMBEDDINGS_STORE, record),
  delete: (articleId: string) => remove(EMBEDDINGS_STORE, articleId),
  clear: () => clear(EMBEDDINGS_STORE),
};

export const localArticleCollections = {
  getAll: () => getAll<LocalArticleCollection>(ARTICLE_COLLECTIONS_STORE),
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
