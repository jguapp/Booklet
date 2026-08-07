/**
 * The local half of semantic search (#156) -- the browser equivalent of the
 * API's article-embedding-service.
 *
 * The point of doing this at all is that local mode is not a degraded mode in
 * this app. Signed-in users getting "why deadlines make people creative" to
 * find an article that never uses those words, while local users get nothing,
 * would be exactly the gap #155 already refused to accept for full-text
 * search.
 *
 * Opt-in, and off by default. The model is a ~25MB download and indexing a
 * library is minutes of CPU, which is not something to spend on someone's
 * behalf because they typed in a search box -- so nothing here fetches
 * anything until the setting is switched on. While it is off, local search is
 * byte-for-byte the keyword search it was before this file existed.
 */
import type { Article } from "@booklet/shared";
import { chunkForEmbedding, rankBySimilarity } from "@booklet/shared";
import { type LocalArticleEmbedding, localEmbeddings } from "@/lib/local/db";
import type { EmbeddingRequest, EmbeddingResponse } from "./embedding-worker";

const ENABLED_KEY = "booklet-semantic-search";

/** Kept small. Each item in a batch is held in memory as a tensor at once, and
 * a batch is also the granularity at which indexing can be interrupted -- too
 * large and closing the tab wastes more finished work than necessary. */
const CHUNK_BATCH = 8;

export function loadSemanticSearchEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(ENABLED_KEY) === "true";
}

export function saveSemanticSearchEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {
    // best-effort only, same as the other device-local prefs
  }
}

/**
 * FNV-1a over the text. Only ever compared against another hash of the same
 * function, never used for security, so a fast non-cryptographic hash is the
 * right tool -- crypto.subtle.digest would be async and slower for no benefit
 * here. Length is mixed in so that a collision needs matching lengths too.
 */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>();

/**
 * Created on first use, never at import time -- constructing it eagerly would
 * spawn a worker (and, on its first message, start a 25MB download) for every
 * visitor including the ones who never search.
 *
 * A plain public/ URL rather than `new URL("./embedding-worker.ts",
 * import.meta.url)`, because Turbopack does not compile that into a worker --
 * it copies the TypeScript source out as a static asset and the browser then
 * cannot parse it. The bundle is built by scripts/build-embedding-worker.mjs,
 * which explains the whole situation.
 */
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("/workers/embedding-worker.js", { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<EmbeddingResponse>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data.vectors);
    else entry.reject(new Error(event.data.error));
  });
  worker.addEventListener("error", (event) => {
    // A worker-level error (the module failed to load at all) never produces
    // per-request replies, so every promise in flight would hang forever
    // without this. Rejecting them all is what lets search fall back to
    // keyword-only instead of never resolving.
    const error = new Error(event.message || "embedding worker failed");
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker = null;
  });
  return worker;
}

function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return Promise.resolve([]);
  const id = nextRequestId++;
  const request: EmbeddingRequest = { id, texts };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage(request);
  });
}

export interface IndexProgress {
  done: number;
  total: number;
}

/**
 * Embeds anything not already embedded, and drops records for articles that
 * are gone.
 *
 * Incremental and resumable by construction rather than by bookkeeping: each
 * article is written as it finishes, and the work still to do is derived by
 * comparing hashes, so closing the tab mid-run loses at most one article and
 * re-running continues from there. That also makes it cheap to call on every
 * load -- a library that is already indexed costs one IndexedDB read.
 *
 * `signal` matters more than it looks: this can run for minutes, and without a
 * way to stop it, toggling the setting off would leave the worker grinding
 * through a library the user just said they did not want indexed.
 */
export async function buildLocalEmbeddingIndex(
  articles: Article[],
  options: { onProgress?: (p: IndexProgress) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const existing = new Map((await localEmbeddings.getAll()).map((r) => [r.id, r]));

  const live = new Set(articles.map((a) => a.id));
  for (const id of existing.keys()) {
    if (!live.has(id)) await localEmbeddings.delete(id);
  }

  const stale = articles.filter((a) => {
    const text = a.extractedText;
    if (!text) return false;
    return existing.get(a.id)?.textHash !== hashText(text);
  });

  let done = 0;
  options.onProgress?.({ done, total: stale.length });

  for (const article of stale) {
    if (options.signal?.aborted) return;

    const chunks = chunkForEmbedding(article.extractedText ?? "");
    const vectors: Float32Array[] = [];
    for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
      if (options.signal?.aborted) return;
      vectors.push(...(await embedTexts(chunks.slice(i, i + CHUNK_BATCH))));
    }

    // Written as one record, so an article is never left indexed by a mixture
    // of old and new chunks.
    const record: LocalArticleEmbedding = {
      id: article.id,
      textHash: hashText(article.extractedText ?? ""),
      vectors,
    };
    await localEmbeddings.put(record);

    done++;
    options.onProgress?.({ done, total: stale.length });
  }
}

/**
 * Ranks the library against a query by meaning, best first.
 *
 * Reads every stored vector and scores in-process, matching the server, which
 * does the same for the same reason: pgvector is not available in the Postgres
 * image this project runs, and at one user's library size an exhaustive scan
 * over a few thousand 384-float vectors is a few milliseconds -- an ANN index
 * would be complexity bought for a scale that does not exist here.
 */
export async function semanticSearchLocal(query: string, limit: number): Promise<string[]> {
  const [queryVector] = await embedTexts([query]);
  if (!queryVector) return [];

  const records = await localEmbeddings.getAll();
  const candidates = records.flatMap((r) => r.vectors.map((vector) => ({ id: r.id, vector })));

  return rankBySimilarity(queryVector, candidates)
    .slice(0, limit)
    .map((r) => r.id);
}

/** Whether anything has been indexed at all. Lets the search path skip
 * spinning up the worker -- and therefore the download -- when there is
 * nothing for it to match against yet. */
export async function hasLocalEmbeddings(): Promise<boolean> {
  const records = await localEmbeddings.getAll();
  return records.some((r) => r.vectors.length > 0);
}

/** Frees the ~100MB of WASM heap the model holds. Worth doing when the setting
 * is switched off, rather than keeping it resident until the tab closes. */
export function terminateEmbeddingWorker(): void {
  worker?.terminate();
  worker = null;
  for (const entry of pending.values()) entry.reject(new Error("embedding worker terminated"));
  pending.clear();
}
