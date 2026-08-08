/**
 * Migrates whatever's currently in local AsyncStorage into the
 * just-authenticated account, then clears it. Mirrors the web app's
 * lib/data/sync.ts against the same POST /api/sync/import endpoint.
 *
 * Like that one, it goes up in batches sized by real payload bytes rather
 * than as a single request, and clears each batch from AsyncStorage only
 * once the server has accepted it. This is not defensive padding: the route
 * caps a body at 32MB (IMPORT_BODY_LIMIT in apps/api/src/routes/sync.ts) and
 * extraction inlines images as base64 data URIs, so a handful of
 * image-heavy saves clears that on their own. Sent as one request, the whole
 * migration then fails at once -- and because App.tsx treats migration as
 * best-effort, the user lands in a synced library that is simply empty,
 * with their articles still on the device but unreachable from the signed-in
 * screens that no longer read local storage. That is #164 exactly, and it is
 * the failure this shape exists to prevent.
 *
 * The second phase the web client runs (#172, uploading PDF/EPUB bytes out
 * of IndexedDB once localIdToServerId says which server id each row got) has
 * no counterpart here: this app has no local raw-file store to migrate from.
 * See saveArticleFromFile in data/articles.ts -- a picked file's bytes go
 * straight to the stateless extraction endpoint and are discarded, so
 * nothing on the device is left behind by a migration.
 */
import type { Article, Highlight, ImportRequest, ImportResponse } from "@booklet/shared";
import { apiFetch } from "../api";
import { localArticleCollections, localArticles, localCollections, localHighlights } from "../local/db";

const EMPTY_RESULT: ImportResponse = {
  importedArticles: 0,
  skippedArticles: 0,
  importedHighlights: 0,
  importedCollections: 0,
  skippedCollections: 0,
  localIdToServerId: {},
};

/**
 * Target serialized size for one batch, matching the web client's. A
 * *target*, not a cap: a single article larger than this still goes up alone
 * rather than being split, since an article is the smallest thing the import
 * route can meaningfully accept, and the route's own limit is set well above
 * this to leave room for exactly that case.
 */
const BATCH_TARGET_BYTES = 4 * 1024 * 1024;

/**
 * Hermes has no TextEncoder, so byte length is counted by hand rather than
 * with the web client's `new TextEncoder().encode(...).length`. Only the
 * multi-byte characters matter -- ASCII, which base64 image payloads are
 * entirely made of, is one byte either way -- and this is sizing a batch,
 * not enforcing a limit, so the count only has to be right, not fast.
 */
function serializedSize(value: unknown): number {
  const json = JSON.stringify(value) ?? "";
  let bytes = 0;
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one 4-byte character; skip its low half.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Thrown when some batches landed and some didn't -- same contract as the
 * web client's, so the caller can tell the user the truth ("42 of 60 moved
 * over") instead of a bare failure, and can say the rest is still on the
 * device rather than gone.
 */
export class PartialMigrationError extends Error {
  constructor(
    readonly progress: ImportResponse,
    readonly remainingArticles: number,
    readonly cause: unknown,
  ) {
    super(`Migration stopped with ${remainingArticles} article(s) still local`);
    this.name = "PartialMigrationError";
  }
}

type ArticlePayload = ImportRequest["articles"][number];
type HighlightPayload = ImportRequest["highlights"][number];

function articlePayload(a: Article): ArticlePayload {
  return {
    localId: a.id,
    url: a.url,
    title: a.title,
    author: a.author,
    siteName: a.siteName,
    excerpt: a.excerpt,
    sourceType: a.sourceType,
    extractionStatus: a.extractionStatus,
    extractionError: a.extractionError,
    extractedHtml: a.extractedHtml,
    extractedText: a.extractedText,
    readingTimeEstimate: a.readingTimeEstimate,
    progressFraction: a.progressFraction,
    activeReadingSeconds: a.activeReadingSeconds,
    tags: a.tags,
    status: a.status,
    savedAt: a.savedAt,
    readAt: a.readAt,
    archivedAt: a.archivedAt,
    favorited: a.favorited,
  };
}

function highlightPayload(h: Highlight): HighlightPayload {
  return {
    localArticleId: h.articleId,
    selectedText: h.selectedText,
    position: h.position,
    color: h.color,
    prompt: h.prompt,
    lastSurfacedAt: h.lastSurfacedAt,
    surfaceCount: h.surfaceCount,
    lastFeedback: h.lastFeedback,
    lastFeedbackAt: h.lastFeedbackAt,
    resurfaceArchivedAt: h.resurfaceArchivedAt,
    createdAt: h.createdAt,
    noteText: h.annotation?.noteText ?? null,
    // The review schedule built up while reading anonymously (#171).
    // Without these, signing up silently resets every highlight to
    // "never reviewed, due now".
    easinessFactor: h.easinessFactor,
    intervalDays: h.intervalDays,
    repetitions: h.repetitions,
    nextDueAt: h.nextDueAt,
  };
}

export async function migrateLocalDataToAccount(): Promise<ImportResponse> {
  const [articles, highlights, collections] = await Promise.all([
    localArticles.getAll(),
    localHighlights.getAll(),
    localCollections.getAll(),
  ]);
  // A fresh object rather than EMPTY_RESULT itself: returning the module
  // constant hands callers a reference they could mutate, and one migration's
  // ids would then show up in the next one's.
  if (articles.length === 0 && highlights.length === 0 && collections.length === 0) {
    return { ...EMPTY_RESULT, localIdToServerId: {} };
  }

  const articleCollections = (
    await Promise.all(collections.map((c) => localArticleCollections.getForCollection(c.id)))
  ).flat();

  const payloadsById = new Map<string, ArticlePayload>(articles.map((a) => [a.id, articlePayload(a)]));

  const highlightsByArticle = new Map<string, { localId: string; payload: HighlightPayload }[]>();
  for (const h of highlights) {
    const list = highlightsByArticle.get(h.articleId) ?? [];
    list.push({ localId: h.id, payload: highlightPayload(h) });
    highlightsByArticle.set(h.articleId, list);
  }

  const linksByArticle = new Map<string, { localArticleId: string; localCollectionId: string }[]>();
  for (const l of articleCollections) {
    const list = linksByArticle.get(l.articleId) ?? [];
    list.push({ localArticleId: l.articleId, localCollectionId: l.collectionId });
    linksByArticle.set(l.articleId, list);
  }

  // Group article ids into batches by their real serialized size. An article
  // over the target on its own becomes its own batch rather than being split.
  const batches: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const article of articles) {
    const size = serializedSize(payloadsById.get(article.id));
    if (current.length > 0 && currentBytes + size > BATCH_TARGET_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(article.id);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);
  // An account whose only local data is collections still needs one request
  // to carry them.
  if (batches.length === 0) batches.push([]);

  const collectionPayloads = collections.map((c) => ({ localId: c.id, name: c.name, color: c.color }));

  const totals: ImportResponse = { ...EMPTY_RESULT, localIdToServerId: {} };
  let migratedArticles = 0;

  for (const batchIds of batches) {
    // Grouped by article because that is the only way the server can attach
    // them: it resolves localArticleId against the articles in *this*
    // request and drops anything it cannot match (see the route). A
    // highlight whose article is not in any batch therefore cannot be
    // migrated at all -- same limitation as the web client, and reachable
    // only if a previous run deleted an article row without its highlights.
    const batchHighlights = batchIds.flatMap((id) => highlightsByArticle.get(id) ?? []);

    const body: ImportRequest = {
      articles: batchIds.map((id) => payloadsById.get(id)!),
      highlights: batchHighlights.map((h) => h.payload),
      // Sent with every batch, not just the first: the server resolves a
      // highlight's or link's article/collection from the localIds present in
      // *that* request, so a later batch's articleCollections would have
      // nothing to resolve against otherwise. Re-sending is idempotent -- the
      // route matches an existing collection by name and skips it -- and the
      // payload is a few names, not article bodies.
      collections: collectionPayloads,
      articleCollections: batchIds.flatMap((id) => linksByArticle.get(id) ?? []),
    };

    let result: ImportResponse;
    try {
      result = await apiFetch<ImportResponse>("/api/sync/import", { method: "POST", body: JSON.stringify(body) });
    } catch (err) {
      // Everything already accepted is on the server and has been removed
      // from AsyncStorage; everything else is still here. Retrying resumes
      // rather than starting over or re-importing what already landed.
      throw new PartialMigrationError(totals, articles.length - migratedArticles, err);
    }

    totals.importedArticles += result.importedArticles;
    totals.skippedArticles += result.skippedArticles;
    totals.importedHighlights += result.importedHighlights;
    // Collections ride along in every batch, so only the batch that actually
    // created them contributes -- summing the skips would multiply them by the
    // batch count and report nonsense.
    totals.importedCollections += result.importedCollections;
    Object.assign(totals.localIdToServerId, result.localIdToServerId ?? {});

    // Clear this batch before sending the next one, so a later failure can't
    // cost work that already succeeded, and a retry doesn't re-send it.
    // deleteMany, not a Promise.all of per-id deletes: each entity type is
    // one JSON map under one AsyncStorage key, so concurrent deletes would
    // overwrite one another and leave most of the batch behind.
    await Promise.all([
      localArticles.deleteMany(batchIds),
      localHighlights.deleteMany(batchHighlights.map((h) => h.localId)),
    ]);
    migratedArticles += batchIds.length;
  }

  totals.skippedCollections = Math.max(0, collections.length - totals.importedCollections);

  await Promise.all([
    localArticles.clear(),
    localHighlights.clear(),
    localCollections.clear(),
    localArticleCollections.clear(),
  ]);
  return totals;
}
