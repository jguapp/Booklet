/**
 * Migrates whatever's currently in local IndexedDB into the just-authenticated
 * account, then clears it -- the server becomes the source of truth for this
 * browser going forward. Runs on every successful login/signup (not just
 * once ever): local storage is normally empty after the first migration, and
 * only has content again if someone used anonymous mode in between sessions.
 *
 * This used to POST the entire local library -- every article's full
 * `extractedHtml` included -- as one JSON body, which is how signing up after
 * reading anonymously could silently empty the library (#164). Fastify's
 * default 1MB body limit rejected the request before it ever reached the
 * route, and extraction inlines images as base64 data URIs (up to 15MB an
 * article), so a *single* image-heavy save could blow the limit on its own.
 * The migration now goes up in batches sized by real payload bytes, and each
 * batch is cleared from IndexedDB only once the server has accepted it, so a
 * failure part-way through leaves the un-migrated remainder intact and a
 * retry resumes instead of starting over (or re-importing what already
 * landed).
 */
import type { ImportRequest, ImportResponse } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";
import { localArticleCollections, localArticles, localCollections, localHighlights } from "@/lib/local/db";

const EMPTY_RESULT: ImportResponse = {
  importedArticles: 0,
  skippedArticles: 0,
  importedHighlights: 0,
  importedCollections: 0,
  skippedCollections: 0,
};

/**
 * Target serialized size for one batch. A *target*, not a cap: a single
 * article larger than this still goes up alone rather than being split, since
 * an article is the smallest thing the import route can meaningfully accept.
 * The route's own bodyLimit (see apps/api/src/routes/sync.ts) is set well
 * above this to leave room for exactly that case.
 */
const BATCH_TARGET_BYTES = 4 * 1024 * 1024;

const encoder = new TextEncoder();
function serializedSize(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Thrown when some batches landed and some didn't. Carries what did get
 * through so the caller can tell the user the truth ("42 of 60 moved over")
 * rather than a bare failure, and so it can say the rest is still here. */
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

export async function migrateLocalDataToAccount(): Promise<ImportResponse> {
  const [articles, highlights, collections] = await Promise.all([
    localArticles.getAll(),
    localHighlights.getAll(),
    localCollections.getAll(),
  ]);

  if (articles.length === 0 && highlights.length === 0 && collections.length === 0) {
    return EMPTY_RESULT;
  }

  const articleCollections = (
    await Promise.all(collections.map((c) => localArticleCollections.getForCollection(c.id)))
  ).flat();

  const articlePayloads = new Map<string, ArticlePayload>(
    articles.map((a) => [
      a.id,
      {
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
      },
    ]),
  );

  const highlightsByArticle = new Map<string, { localId: string; payload: HighlightPayload }[]>();
  for (const h of highlights) {
    const list = highlightsByArticle.get(h.articleId) ?? [];
    list.push({
      localId: h.id,
      payload: {
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
      },
    });
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
    const size = serializedSize(articlePayloads.get(article.id));
    if (current.length > 0 && currentBytes + size > BATCH_TARGET_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(article.id);
    currentBytes += size;
  }
  if (current.length > 0) batches.push(current);
  // Collections with no articles at all still need a request to carry them.
  if (batches.length === 0) batches.push([]);

  const collectionPayloads = collections.map((c) => ({ localId: c.id, name: c.name, color: c.color }));

  const totals: ImportResponse = { ...EMPTY_RESULT };
  let migratedArticles = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchIds = batches[i];
    const batchHighlights = batchIds.flatMap((id) => highlightsByArticle.get(id) ?? []);

    const body: ImportRequest = {
      articles: batchIds.map((id) => articlePayloads.get(id)!),
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
      // Everything already accepted stays on the server and has been removed
      // from IndexedDB; everything else is still local. Report both.
      throw new PartialMigrationError(totals, articles.length - migratedArticles, err);
    }

    totals.importedArticles += result.importedArticles;
    totals.skippedArticles += result.skippedArticles;
    totals.importedHighlights += result.importedHighlights;
    // Collections ride along in every batch, so only the batch that actually
    // created them contributes -- summing the skips would multiply them by the
    // batch count and report nonsense.
    totals.importedCollections += result.importedCollections;

    // Clear this batch before sending the next one, so a later failure can't
    // cost work that already succeeded, and a retry doesn't re-send it.
    await Promise.all([
      ...batchIds.map((id) => localArticles.delete(id)),
      ...batchHighlights.map((h) => localHighlights.delete(h.localId)),
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
