/**
 * IndexedDB-backed local storage for articles and highlights -- this is what
 * makes Booklet fully usable without an account. Signing in doesn't replace
 * this; it adds a synced copy on the server (see lib/data/*) while this
 * stays the source of truth for anyone who never creates an account.
 */
import type { Article, Highlight } from "@booklet/shared";

const DB_NAME = "booklet";
const DB_VERSION = 1;
const ARTICLES_STORE = "articles";
const HIGHLIGHTS_STORE = "highlights";

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

async function replaceAll(storeName: string, values: unknown[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  store.clear();
  for (const value of values) store.put(value);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const localArticles = {
  getAll: () => getAll<Article>(ARTICLES_STORE),
  get: (id: string) => getOne<Article>(ARTICLES_STORE, id),
  put: (article: Article) => put(ARTICLES_STORE, article),
  delete: (id: string) => remove(ARTICLES_STORE, id),
};

export const localHighlights = {
  getAll: () => getAll<Highlight>(HIGHLIGHTS_STORE),
  replaceAll: (highlights: Highlight[]) => replaceAll(HIGHLIGHTS_STORE, highlights),
};
