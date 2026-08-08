import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ImportRequest, ImportResponse } from "@booklet/shared";
import { canonicalizeUrl, normalizeRecallPrompt } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { sanitizeArticleHtml } from "../lib/sanitize.js";
import { requireAuth } from "../lib/auth/context.js";

/**
 * Headroom for one migration batch (see apps/web/src/lib/data/sync.ts, which
 * aims at 4MB a batch). Set deliberately rather than left at Fastify's 1MB
 * default, which is what silently emptied libraries on signup (#164).
 *
 * It has to clear a single article on its own, and extraction inlines up to
 * 15MB of images plus a 512KB cover as base64 -- roughly 21MB of characters
 * once base64's ~33% inflation is counted, before JSON escaping. 32MB covers
 * that with room to spare.
 *
 * The cost: Fastify parses the body before `preHandler`, so this buffer is
 * reachable pre-authentication. That is the same exposure every route with a
 * body has, bounded here by the global rate limit, and it is scoped to this
 * one route rather than raised app-wide.
 */
const IMPORT_BODY_LIMIT = 32 * 1024 * 1024;

/**
 * SM-2 state arriving from a client is untrusted input like anything else,
 * and this route must not become a way around the checks
 * PATCH /api/highlights/:id already enforces on the same four columns.
 * Anything out of range falls back to the schema default rather than
 * rejecting the whole batch: a single bad number should not cost someone
 * their library on the one request that migrates it.
 */
function sm2FromImport(h: {
  easinessFactor?: number;
  intervalDays?: number;
  repetitions?: number;
  nextDueAt?: string | null;
}) {
  const ef = typeof h.easinessFactor === "number" && h.easinessFactor >= 1.3 ? h.easinessFactor : 2.5;
  const days = Number.isInteger(h.intervalDays) && h.intervalDays! >= 0 ? h.intervalDays! : 0;
  const reps = Number.isInteger(h.repetitions) && h.repetitions! >= 0 ? h.repetitions! : 0;
  const due = h.nextDueAt ? new Date(h.nextDueAt) : null;
  return {
    easinessFactor: ef,
    intervalDays: days,
    repetitions: reps,
    // An unparseable date reads as NaN and would throw at the driver.
    nextDueAt: due && !Number.isNaN(due.getTime()) ? due : null,
  };
}

/** Stand-in for the unique constraint Highlight doesn't have, used to make a
 * re-sent batch idempotent. Object keys are sorted so the same position
 * serializes identically whether it came off the wire or back out of
 * Postgres's jsonb (which does not preserve key order). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/// The separator is a literal NUL escape rather than a raw NUL byte: a raw
/// one makes this file "binary" to grep/ripgrep, which silently hides every
/// match in it from a repo-wide search.
const KEY_SEPARATOR = "\u0000";

function highlightKey(articleId: string, selectedText: string, position: unknown): string {
  return [articleId, selectedText, stableStringify(position)].join(KEY_SEPARATOR);
}

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ImportRequest }>(
    "/api/sync/import",
    { preHandler: requireAuth, bodyLimit: IMPORT_BODY_LIMIT },
    async (request, reply) => {
      const {
        articles,
        highlights,
        collections = [],
        articleCollections = [],
      } = request.body ?? { articles: [], highlights: [] };
      const userId = request.userId!;

      if (!Array.isArray(articles) || !Array.isArray(highlights)) {
        return reply.code(400).send({ error: "invalid_body", message: "articles and highlights must be arrays." });
      }

      // This route used to issue a findUnique + create per article and per
      // highlight -- ~4,000 serialized round trips for a 2,000-article Pocket
      // import, inside one HTTP request. Every phase below is now a bounded
      // number of queries regardless of row count. Ids are generated here
      // rather than left to Prisma's cuid default precisely so createMany can
      // be used and the localId -> server id mapping still comes back without
      // a per-row round trip.

      /*
       * Considered and rejected: wrapping all five phases below in one
       * interactive `prisma.$transaction`. Recording it here because "this
       * route has no transaction" reads as an oversight, and it is a choice.
       *
       * The failure it would prevent is real but self-healing. An
       * interruption between the article phase and the highlight phase leaves
       * articles with no highlights -- and the next attempt at that batch
       * fixes it, because every phase here is idempotent on purpose: the
       * articles come back as already-present and are skipped, and their
       * highlights, which the dedupe query correctly finds none of, are
       * created. The client keeps a batch in IndexedDB until the server has
       * acknowledged it (apps/web/src/lib/data/sync.ts deletes local rows only
       * after the response lands), so the retry has the data to send. The one
       * phase boundary that did *not* heal was highlights -> notes, and that
       * one is now a transaction of its own below.
       *
       * What wrapping everything would cost is not self-healing.
       *
       * 1. All-or-nothing turns partial progress into no progress. A 32MB
       *    batch that dies at 90% currently leaves 90% committed and the
       *    retry finishes the job. Rolled back, every attempt starts from
       *    zero -- so the user whose connection cannot hold long enough to
       *    finish once can never migrate at all, and it is precisely the
       *    biggest libraries, on the worst connections, that need the most
       *    attempts. That inverts who the transaction protects.
       * 2. An interactive transaction holds a pooled connection for the whole
       *    request, and the expensive part of this request is not the
       *    database: sanitizeArticleHtml runs JSDOM over every article body,
       *    up to 15MB of inlined images each. That is CPU time spent with a
       *    connection pinned and a transaction open. A handful of concurrent
       *    imports on a small pool starves every other route on the instance
       *    -- a wider outage than the narrow inconsistency being fixed, and
       *    one nothing retries its way out of.
       * 3. Prisma's interactive transactions time out (5s by default). A
       *    thousand-row batch would routinely exceed it, converting a
       *    recoverable partial import into a guaranteed hard failure.
       *
       * If a genuinely atomic import is wanted later, the shape is a staging
       * table plus a server-side merge, not a long-lived connection held open
       * across JSDOM.
       */

      // localId -> real server Article id, so highlights can attach whether
      // their article was newly created here or already existed (same URL).
      const localIdToServerId = new Map<string, string>();
      let skippedArticles = 0;

      const valid = articles.filter((a) => typeof a.localId === "string" && a.localId);

      const urls = valid.map((a) => a.url).filter((u): u is string => typeof u === "string" && !!u);
      const existing = urls.length
        ? await prisma.article.findMany({ where: { userId, url: { in: urls } }, select: { id: true, url: true } })
        : [];
      const existingByUrl = new Map(existing.map((e) => [e.url!, e.id]));

      // Two local articles can share a URL (saved twice before dedupe existed).
      // createMany would trip @@unique([userId, url]) on the second, taking the
      // whole batch down with it, so the duplicate is treated exactly like an
      // already-on-the-server one: mapped to the same id, counted as skipped.
      // The URL dedupe above covers saved links. It does not cover an
      // article with no URL -- every uploaded PDF and EPUB, and every
      // Kindle-clippings BOOK -- because `if (a.url)` simply skips them, so
      // a replayed batch created them again, unconditionally. Their
      // highlights doubled too: the fresh duplicate lands in toCreate, which
      // is exactly the set the highlight dedupe query excludes as "can't
      // already have highlights".
      //
      // That is the same replay this route's comments already describe
      // defending against. It was defended on one arm only, and the tests
      // covered only that arm.
      //
      // The natural key for a url-less article is its title and the moment
      // it was saved. savedAt comes from the client and is preserved
      // exactly, so a replay carries identical values, while two genuinely
      // distinct uploads sharing a title *and* a millisecond is not a
      // situation worth splitting. Deliberately not localId: nothing stores
      // it server-side, and adding a column to hold it would be a schema
      // change to solve what a natural key already answers.
      const urllessKey = (title: string | null | undefined, savedAt: string | null | undefined) =>
        [title ?? "", savedAt ?? ""].join(KEY_SEPARATOR);

      const urllessCandidates = valid.filter((a) => !a.url);
      const existingUrlless = urllessCandidates.length
        ? await prisma.article.findMany({
            where: {
              userId,
              url: null,
              OR: urllessCandidates.map((a) => ({
                title: a.title ?? null,
                savedAt: a.savedAt ? new Date(a.savedAt) : undefined,
              })),
            },
            select: { id: true, title: true, savedAt: true },
          })
        : [];
      const existingByUrlless = new Map(
        existingUrlless.map((e) => [urllessKey(e.title, e.savedAt.toISOString()), e.id]),
      );

      const claimedUrls = new Map<string, string>();
      const claimedUrlless = new Map<string, string>();
      const toCreate: { id: string; article: (typeof valid)[number] }[] = [];

      for (const a of valid) {
        if (a.url) {
          const already = existingByUrl.get(a.url) ?? claimedUrls.get(a.url);
          if (already) {
            localIdToServerId.set(a.localId, already);
            skippedArticles++;
            continue;
          }
        } else {
          const key = urllessKey(a.title, a.savedAt);
          const already = existingByUrlless.get(key) ?? claimedUrlless.get(key);
          if (already) {
            localIdToServerId.set(a.localId, already);
            skippedArticles++;
            continue;
          }
        }
        const id = randomUUID();
        if (a.url) claimedUrls.set(a.url, id);
        else claimedUrlless.set(urllessKey(a.title, a.savedAt), id);
        localIdToServerId.set(a.localId, id);
        toCreate.push({ id, article: a });
      }

      if (toCreate.length > 0) {
        await prisma.article.createMany({
          data: toCreate.map(({ id, article: a }) => ({
            id,
            userId,
            url: a.url ?? null,
            // Derived here rather than trusted from the payload, matching
            // POST /api/articles. Without it every migrated article carried
            // canonicalUrl: null, and duplicate detection matches on
            // `url OR canonicalUrl` -- so re-saving a migrated article from
            // a link with a tracking parameter missed both arms and created
            // a second copy. Silent, permanent (nothing backfills it), and
            // it degraded exactly the articles a user cared enough about to
            // have saved before signing up.
            canonicalUrl: a.url ? canonicalizeUrl(a.url) : null,
            title: a.title ?? null,
            author: a.author ?? null,
            siteName: a.siteName ?? null,
            excerpt: a.excerpt ?? null,
            sourceType: a.sourceType ?? "HTML",
            extractionStatus: a.extractionStatus ?? "SUCCESS",
            extractionError: a.extractionError ?? null,
            // Sanitized like every other stored article, and with more reason:
            // this value is whatever the client posted, not something this
            // server's extraction produced. A migration payload is the one
            // place hostile HTML can be uploaded directly.
            extractedHtml: sanitizeArticleHtml(a.extractedHtml),
            extractedText: a.extractedText ?? null,
            readingTimeEstimate: a.readingTimeEstimate ?? null,
            progressFraction: typeof a.progressFraction === "number" ? a.progressFraction : 0,
            activeReadingSeconds:
              typeof a.activeReadingSeconds === "number" ? Math.max(0, a.activeReadingSeconds) : 0,
            tags: Array.isArray(a.tags) ? a.tags.filter((t) => typeof t === "string" && t.trim()) : [],
            status: a.status ?? "UNREAD",
            savedAt: a.savedAt ? new Date(a.savedAt) : new Date(),
            readAt: a.readAt ? new Date(a.readAt) : null,
            archivedAt: a.archivedAt ? new Date(a.archivedAt) : null,
            favorited: a.favorited ?? false,
          })),
        });
      }
      const importedArticles = toCreate.length;

      // Highlights have no natural unique constraint, so a re-sent batch used
      // to duplicate every one of them. That matters more now than it did:
      // the client retries at batch granularity, so a batch the server
      // committed but whose response never made it back gets sent again --
      // articles dedupe by URL, and highlights need to as well or a dropped
      // response quietly doubles someone's notebook.
      //
      // Only articles that already existed can already have highlights, so
      // this looks at exactly those, and skips the query entirely on a first
      // import (where every article is new).
      const preexistingArticleIds = [...new Set(articles.map((a) => localIdToServerId.get(a.localId)))]
        .filter((id): id is string => !!id)
        .filter((id) => !toCreate.some((c) => c.id === id));
      const alreadyThere = preexistingArticleIds.length
        ? await prisma.highlight.findMany({
            where: { userId, articleId: { in: preexistingArticleIds } },
            select: { articleId: true, selectedText: true, position: true },
          })
        : [];
      const seen = new Set(alreadyThere.map((h) => highlightKey(h.articleId, h.selectedText, h.position)));

      const highlightRows: { id: string; articleId: string; highlight: (typeof highlights)[number] }[] = [];
      for (const h of highlights) {
        const articleId = localIdToServerId.get(h.localArticleId);
        if (!articleId) continue; // that article's import was skipped/invalid -- nothing to attach to
        if (typeof h.selectedText !== "string" || !h.selectedText) continue;
        if (typeof h.position !== "object" || h.position === null) continue;
        // Also guards against the same highlight appearing twice inside one
        // payload, not just against a replay of a previous one.
        const key = highlightKey(articleId, h.selectedText, h.position);
        if (seen.has(key)) continue;
        seen.add(key);
        highlightRows.push({ id: randomUUID(), articleId, highlight: h });
      }

      if (highlightRows.length > 0) {
        const highlightData = highlightRows.map(({ id, articleId, highlight: h }) => ({
          id,
          articleId,
          userId,
          selectedText: h.selectedText,
          position: h.position as object,
          color: h.color ?? "YELLOW",
          prompt: normalizeRecallPrompt(h.prompt),
          lastSurfacedAt: h.lastSurfacedAt ? new Date(h.lastSurfacedAt) : null,
          surfaceCount: typeof h.surfaceCount === "number" ? h.surfaceCount : 0,
          lastFeedback: h.lastFeedback ?? null,
          lastFeedbackAt: h.lastFeedbackAt ? new Date(h.lastFeedbackAt) : null,
          resurfaceArchivedAt: h.resurfaceArchivedAt ? new Date(h.resurfaceArchivedAt) : null,
          createdAt: h.createdAt ? new Date(h.createdAt) : new Date(),
          ...sm2FromImport(h),
        }));

        // Notes are a separate table, so they go in their own pass now that the
        // highlight ids are known up front instead of riding a nested create.
        const notes = highlightRows
          .map(({ id, highlight: h }) => ({ highlightId: id, userId, noteText: h.noteText?.trim() ?? "" }))
          .filter((n) => n.noteText);

        // The one seam in this route that a replay cannot heal, and the only
        // reason there is a transaction here at all.
        //
        // Every other phase is idempotent by construction, which is what
        // makes the missing whole-route transaction survivable: an
        // interruption leaves rows the next attempt recognises (articles by
        // url, or by title+savedAt; collections by name; links by their
        // composite PK) and skips, and the phases that never ran simply run.
        // Highlights are the case that proves it -- articles committed
        // without their highlights come back as *pre-existing* articles on
        // the retry, so the dedupe query finds no highlights on them and
        // creates the lot.
        //
        // Notes break that. A note is only ever written alongside the
        // highlight it belongs to, so if the highlights commit and this
        // insert does not, the retry dedupes those same highlights away,
        // highlightRows comes back empty, and the note is never written by
        // anything, ever. Silent, and permanent -- the highlight is there, so
        // nothing looks lost until someone goes looking for what they wrote
        // under it.
        //
        // Batched form (an array), deliberately not the interactive
        // `$transaction(async tx => ...)` callback: both statements are built
        // before either is sent, so this is one round trip that opens and
        // commits without ever going idle waiting on this process. It holds a
        // connection for two inserts, not for a 32MB request.
        await prisma.$transaction([
          prisma.highlight.createMany({ data: highlightData }),
          ...(notes.length > 0 ? [prisma.annotation.createMany({ data: notes })] : []),
        ]);
      }
      const importedHighlights = highlightRows.length;

      const localCollectionIdToServerId = new Map<string, string>();
      let skippedCollections = 0;

      const namedCollections = collections
        .map((c) => ({ localId: c.localId, name: c.name?.trim(), color: c.color }))
        .filter((c): c is { localId: string; name: string; color: string | null } => {
          return typeof c.localId === "string" && !!c.localId && !!c.name;
        });

      const existingCollections = namedCollections.length
        ? await prisma.collection.findMany({
            where: { userId, name: { in: namedCollections.map((c) => c.name) } },
            select: { id: true, name: true },
          })
        : [];
      const existingCollectionByName = new Map(existingCollections.map((c) => [c.name, c.id]));

      const claimedNames = new Map<string, string>();
      const collectionsToCreate: { id: string; name: string; color: string | null }[] = [];
      for (const c of namedCollections) {
        const already = existingCollectionByName.get(c.name) ?? claimedNames.get(c.name);
        if (already) {
          localCollectionIdToServerId.set(c.localId, already);
          skippedCollections++;
          continue;
        }
        const id = randomUUID();
        claimedNames.set(c.name, id);
        localCollectionIdToServerId.set(c.localId, id);
        collectionsToCreate.push({ id, name: c.name, color: c.color ?? null });
      }

      if (collectionsToCreate.length > 0) {
        await prisma.collection.createMany({
          data: collectionsToCreate.map((c) => ({ id: c.id, userId, name: c.name, color: c.color })),
        });
      }
      const importedCollections = collectionsToCreate.length;

      const links = articleCollections
        .map((link) => ({
          articleId: localIdToServerId.get(link.localArticleId),
          collectionId: localCollectionIdToServerId.get(link.localCollectionId),
        }))
        .filter((l): l is { articleId: string; collectionId: string } => !!l.articleId && !!l.collectionId);
      if (links.length > 0) {
        // skipDuplicates rather than the old per-row upsert: the composite
        // primary key already makes a repeat link a no-op, and a re-sent batch
        // is an expected shape here, not an error.
        await prisma.articleCollection.createMany({ data: links, skipDuplicates: true });
      }

      const body: ImportResponse = {
        importedArticles,
        skippedArticles,
        importedHighlights,
        importedCollections,
        skippedCollections,
        // The client needs these to finish the job: an uploaded PDF/EPUB's
        // bytes are still in IndexedDB under the *local* id, and only this
        // map says which server article they belong to (#172). Sent for
        // skipped articles too -- a re-sent batch must be able to attach a
        // file to the row the previous attempt created.
        localIdToServerId: Object.fromEntries(localIdToServerId),
      };
      return reply.send(body);
    },
  );
}
