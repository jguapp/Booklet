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
 *
 * An uploaded PDF or EPUB needs a second phase (#172). Its bytes are in
 * IndexedDB, not in the article payload -- a 20MB book is ~27MB of base64
 * before JSON escaping, which is a whole batch on its own -- so the row goes
 * up with the batch and the file follows as its own multipart request, once
 * the batch's response has said which server id the row was given. Until
 * that request is accepted the file stays in IndexedDB, same rule as the
 * batches, and the reader falls back to it (see lib/data/articles.ts) so a
 * book opened mid-migration shows its pages instead of an empty reader.
 */
import type { Article, ImportRequest, ImportResponse } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";
import {
  localArticleCollections,
  localArticles,
  localCollections,
  localFiles,
  localHighlights,
} from "@/lib/local/db";

const EMPTY_RESULT: ImportResponse = {
  importedArticles: 0,
  skippedArticles: 0,
  importedHighlights: 0,
  importedCollections: 0,
  skippedCollections: 0,
  localIdToServerId: {},
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
    /**
     * Counts articles whose row never left this device *and* articles whose
     * row landed but whose uploaded file did not (#172). One number because
     * the library's failure notice keys off exactly this one, and only
     * renders at all when it is above zero -- an uploaded book stranded
     * without its bytes has to make it non-zero or "your library moved but
     * three books are empty" goes unreported again, which is the silence
     * this whole class exists to break. `remainingFiles` below says how many
     * of the count are that second kind.
     */
    readonly remainingArticles: number,
    readonly cause: unknown,
    readonly remainingFiles = 0,
  ) {
    super(`Migration stopped with ${remainingArticles} article(s) still local`);
    this.name = "PartialMigrationError";
  }
}

type ArticlePayload = ImportRequest["articles"][number];
type HighlightPayload = ImportRequest["highlights"][number];

/**
 * A file whose article row is already on the server but whose bytes are
 * still only in IndexedDB, under `localArticleId`.
 *
 * Kept in localStorage rather than IndexedDB because the record has to
 * outlive the article row it came from: the row is deleted from IndexedDB
 * the moment the server accepts its batch, and after that nothing else on
 * this device remembers that server article X is local article Y, which is
 * the only way back to the bytes. A tab closed mid-migration therefore has
 * to find this on the next load, and it is a few dozen bytes per book.
 */
export interface PendingFileUpload {
  serverArticleId: string;
  localArticleId: string;
  /** The server rejects anything not ending .pdf/.epub, so this is carried
   * rather than re-derived -- the article row it came from is gone by the
   * time the upload runs. */
  filename: string;
}

const PENDING_FILE_UPLOADS_KEY = "booklet.pendingFileUploads";

function isPendingFileUpload(value: unknown): value is PendingFileUpload {
  const v = value as PendingFileUpload | null;
  return (
    !!v &&
    typeof v.serverArticleId === "string" &&
    typeof v.localArticleId === "string" &&
    typeof v.filename === "string"
  );
}

function readPendingFileUploads(): PendingFileUpload[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PENDING_FILE_UPLOADS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isPendingFileUpload) : [];
  } catch {
    // Unreadable or corrupt is the same as absent: the bytes are still in
    // IndexedDB either way, and throwing here would take down a migration
    // that has nothing to do with this file.
    return [];
  }
}

function writePendingFileUploads(entries: PendingFileUpload[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (entries.length === 0) localStorage.removeItem(PENDING_FILE_UPLOADS_KEY);
    else localStorage.setItem(PENDING_FILE_UPLOADS_KEY, JSON.stringify(entries));
  } catch {
    // Full or blocked (Safari private mode). The upload still happens in
    // this run; only resuming a *later* run is lost, and losing that is
    // better than failing the migration over a bookkeeping write.
  }
}

/** The reader's way back to a book still mid-migration -- see
 * loadArticleFile in lib/data/articles.ts. */
export function pendingFileUploadFor(serverArticleId: string): PendingFileUpload | null {
  return readPendingFileUploads().find((e) => e.serverArticleId === serverArticleId) ?? null;
}

function dropPendingFileUpload(serverArticleId: string): void {
  writePendingFileUploads(readPendingFileUploads().filter((e) => e.serverArticleId !== serverArticleId));
}

/** Only PDF/EPUB rows have bytes in IndexedDB at all. Returns the name to
 * send them under, or null when there is nothing to send. */
function uploadFilenameFor(article: Article): string | null {
  if (article.sourceType !== "PDF" && article.sourceType !== "EPUB") return null;
  const ext = article.sourceType === "PDF" ? "pdf" : "epub";
  const name = article.originalFilename?.trim() || `${article.title?.trim() || "book"}.${ext}`;
  // A book renamed in the library ("Chapter notes") loses the extension the
  // server validates on, so it is put back rather than 400ing the upload.
  return name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`;
}

async function uploadPendingFile(entry: PendingFileUpload): Promise<void> {
  const local = await localFiles.get(entry.localArticleId);
  if (!local) {
    // A PDF/EPUB row whose bytes were never in IndexedDB (saved by a client
    // old enough to predate the files store, or cleared by hand). Nothing to
    // retry forever over.
    dropPendingFileUpload(entry.serverArticleId);
    return;
  }

  const form = new FormData();
  form.append("file", local.blob, entry.filename);
  await apiFetch<unknown>(`/api/articles/${entry.serverArticleId}/file`, { method: "POST", body: form });

  // Only now, and in this order: the same batch-then-clear rule the article
  // batches follow. Losing the registry entry first would strand the blob
  // with nothing pointing at it; losing the blob before the server has it
  // would destroy the one copy of a file the user cannot re-download.
  await localFiles.delete(entry.localArticleId);
  dropPendingFileUpload(entry.serverArticleId);
}

/**
 * Sends every pending file (or just the given server ids). Failures are
 * returned rather than thrown: one book that will not upload must not stop
 * the rest of a library from moving, and the caller reports them all
 * together at the end.
 */
async function flushPendingFileUploads(serverArticleIds?: Set<string>): Promise<Map<string, unknown>> {
  const failures = new Map<string, unknown>();
  const pending = readPendingFileUploads().filter((e) => !serverArticleIds || serverArticleIds.has(e.serverArticleId));
  // Sequential on purpose -- these are whole books, and firing a library's
  // worth of multi-megabyte uploads at once is how a migration turns into a
  // stalled tab.
  for (const entry of pending) {
    try {
      await uploadPendingFile(entry);
    } catch (err) {
      failures.set(entry.serverArticleId, err);
    }
  }
  return failures;
}

export async function migrateLocalDataToAccount(): Promise<ImportResponse> {
  // Keyed by server article id so a file that failed here isn't retried and
  // re-counted by a later batch's flush.
  const fileFailures = new Map<string, unknown>();

  // Before anything else, and before the emptiness check below: a previous
  // run can have moved every article and then died part-way through the
  // uploads, which leaves nothing local for that check to see even though
  // books are still stranded. This is what makes the retry button finish
  // them rather than report "nothing to do".
  for (const [id, err] of await flushPendingFileUploads()) fileFailures.set(id, err);

  const [articles, highlights, collections] = await Promise.all([
    localArticles.getAll(),
    localHighlights.getAll(),
    localCollections.getAll(),
  ]);

  if (articles.length === 0 && highlights.length === 0 && collections.length === 0) {
    if (fileFailures.size > 0) {
      throw new PartialMigrationError(EMPTY_RESULT, fileFailures.size, [...fileFailures.values()][0], fileFailures.size);
    }
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
        // The review schedule built up while reading anonymously (#171).
        // Without these, signing up silently resets every highlight to
        // "never reviewed, due now".
        easinessFactor: h.easinessFactor,
        intervalDays: h.intervalDays,
        repetitions: h.repetitions,
        nextDueAt: h.nextDueAt,
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

  // Not a spread of EMPTY_RESULT: that would alias its localIdToServerId
  // object into every call's totals, so one migration's ids would leak into
  // the next one's.
  const totals: ImportResponse = { ...EMPTY_RESULT, localIdToServerId: {} };
  let migratedArticles = 0;
  const articlesById = new Map(articles.map((a) => [a.id, a]));

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
      // from IndexedDB; everything else is still local. Report both, plus any
      // book whose bytes didn't make it -- its row is on the server, so it
      // isn't in the un-migrated remainder and would otherwise vanish from
      // the count.
      throw new PartialMigrationError(
        totals,
        articles.length - migratedArticles + fileFailures.size,
        err,
        fileFailures.size,
      );
    }

    totals.importedArticles += result.importedArticles;
    totals.skippedArticles += result.skippedArticles;
    totals.importedHighlights += result.importedHighlights;
    // Collections ride along in every batch, so only the batch that actually
    // created them contributes -- summing the skips would multiply them by the
    // batch count and report nonsense.
    totals.importedCollections += result.importedCollections;
    Object.assign(totals.localIdToServerId, result.localIdToServerId);

    // Written before the article rows are deleted below, not after: the
    // filename and the local id live on those rows, and once they are gone
    // this registry is the only thing on the device that can still find the
    // bytes for a given server article. A crash in between would leave a
    // book's file orphaned in IndexedDB with nothing able to name it.
    const batchUploads: PendingFileUpload[] = [];
    for (const localId of batchIds) {
      const article = articlesById.get(localId);
      const serverArticleId = result.localIdToServerId?.[localId];
      const filename = article ? uploadFilenameFor(article) : null;
      if (!article || !serverArticleId || !filename) continue;
      batchUploads.push({ serverArticleId, localArticleId: localId, filename });
    }
    if (batchUploads.length > 0) {
      const existing = readPendingFileUploads();
      const added = batchUploads.filter((u) => !existing.some((e) => e.serverArticleId === u.serverArticleId));
      writePendingFileUploads([...existing, ...added]);
    }

    // Clear this batch before sending the next one, so a later failure can't
    // cost work that already succeeded, and a retry doesn't re-send it. The
    // files are deliberately not cleared here -- each one goes only after the
    // server has accepted that file, in uploadPendingFile.
    await Promise.all([
      ...batchIds.map((id) => localArticles.delete(id)),
      ...batchHighlights.map((h) => localHighlights.delete(h.localId)),
    ]);
    migratedArticles += batchIds.length;

    // Per batch rather than once at the end, so an interruption costs at most
    // one batch's uploads -- and so a book becomes readable from the server
    // as soon as its own batch is through, instead of after the whole library.
    if (batchUploads.length > 0) {
      const ids = new Set(batchUploads.map((u) => u.serverArticleId));
      for (const [id, err] of await flushPendingFileUploads(ids)) fileFailures.set(id, err);
    }
  }

  totals.skippedCollections = Math.max(0, collections.length - totals.importedCollections);

  // Note the absence of localFiles.clear(): a book whose upload failed still
  // has its only copy in here, and the reader is still serving it from here
  // (loadArticleFile's 404 fallback). It is cleared one file at a time, by
  // the upload that succeeded.
  await Promise.all([
    localArticles.clear(),
    localHighlights.clear(),
    localCollections.clear(),
    localArticleCollections.clear(),
  ]);

  // The articles all moved, so nothing above threw -- but a book on the
  // server with no bytes behind it is exactly the "migrated and empty" the
  // user would otherwise discover by opening it weeks later. Reported with
  // what did land, so the notice can still say what worked.
  if (fileFailures.size > 0) {
    throw new PartialMigrationError(totals, fileFailures.size, [...fileFailures.values()][0], fileFailures.size);
  }

  return totals;
}
