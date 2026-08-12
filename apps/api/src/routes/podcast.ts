import { randomBytes } from "node:crypto";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import {
  DEFAULT_PODCAST_FEED_FILTER,
  PODCAST_FEED_SCOPE,
  isPodcastFeedFilter,
  toSafeTextChunks,
  type PodcastFeedFilter,
  type PodcastFeedSecret,
  type PodcastFeedStatus,
} from "@booklet/shared";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { hashApiToken } from "../lib/auth/api-token.js";
import { concatPcm16Wavs, pcm16WavDurationSeconds } from "../services/audio-concat.js";
import { buildPodcastFeedXml, type PodcastEpisodeInput } from "../services/podcast-feed.js";
import { generateSpeechPooled } from "../services/tts-pool.js";
import { deleteStoredFile, saveFile, streamStoredFile } from "../services/storage-service.js";
import {
  PODCAST_AUDIO_QUOTA_BYTES,
  evictEpisodesOutsideFeed,
  podcastAudioBytesUsed,
} from "../services/podcast-storage.js";

/**
 * The personal podcast feed (#154): the reading queue as an RSS feed a normal
 * podcast app can subscribe to, with one generated audio file per article.
 *
 * Two open questions from the issue, answered here rather than left to
 * whoever reads the code next:
 *
 * 1. Which articles? The queue -- unread and in-progress -- by default, not
 *    the whole library. See PodcastFeedFilter in @booklet/shared for why that
 *    is about podcast-client behaviour (auto-download of everything it has
 *    not seen) rather than taste. `?filter=all` opts into the back catalogue.
 *
 * 2. Does listening write progress back? No, and it cannot. Podcast clients
 *    do not report playback position to the feed's server -- there is no
 *    field, no callback and no standard for it. The only signal that ever
 *    reaches us is "someone fetched the enclosure", which says nothing about
 *    whether it was played. So an article listened to end-to-end in Overcast
 *    stays UNREAD in Booklet. That is a limitation of the medium, not a bug
 *    to file, and it is stated in the settings UI so nobody reports it as one.
 */

/**
 * Feed tokens carry their own prefix, and this is the security boundary the
 * issue asks for ("must not be usable against the rest of /api/v1") -- not a
 * scope check bolted onto each v1 route.
 *
 * lib/auth/context.ts only looks up an ApiToken when looksLikeApiToken() is
 * true, i.e. when the bearer starts with "blk_". A "bkpod_" token fails that
 * test, falls through to verifyAccessToken(), fails to parse as a JWT, and
 * leaves request.userId null -- so presenting a feed token in an
 * Authorization header authenticates nothing, anywhere in the app, including
 * every /api/v1 route that exists today and every one added later. A scope
 * check would have to be remembered on each new route; this cannot be
 * forgotten, because the token never becomes a session in the first place.
 *
 * The reverse direction is closed here (see authenticateFeedToken): an
 * ordinary "blk_" PAT is rejected at the feed URL even if someone pastes it
 * in, because feed access additionally requires the PODCAST_FEED_SCOPE that
 * POST /api/tokens refuses to mint.
 */
const FEED_TOKEN_PREFIX = "bkpod_";

/** 32 bytes, same as every other opaque token in this app (tokens.ts). The
 * URL is the entire credential, so it is sized against offline guessing, not
 * against looking tidy in a podcast app's "add by URL" box. */
function generateFeedToken(): string {
  return `${FEED_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

/** How many items the feed lists. A podcast client renders everything it is
 * given, so an unbounded feed means a 400-item episode list and a document
 * that grows without limit for someone who never archives anything.
 *
 * Since the S5 fix this is also the disk ceiling, not only the document one: audio
 * outside this window is deleted rather than kept forever (see
 * services/podcast-storage.ts), so raising this number raises how many WAVs
 * an account stores at rest. */
const MAX_FEED_ITEMS = 50;

/**
 * Voice and speed for generated episodes.
 *
 * There is no server-side TTS preference to read: the reader's voice picker
 * writes to device prefs in localStorage (device-prefs-provider.tsx), which
 * the API never sees. So the feed picks one and records it on the
 * ArticleAudio row, which is what makes changing this later a cache
 * invalidation rather than a migration -- every episode generated with a
 * different voice is rebuilt on the next feed fetch.
 */
const PODCAST_VOICE = process.env.PODCAST_VOICE ?? "af_heart";
const PODCAST_SPEED = 1;

/**
 * Ceiling on a single episode, in chunks (~140 characters each).
 *
 * 250 chunks is roughly 35,000 characters, ~40 minutes of speech, ~115 MB of
 * 16-bit PCM. The limit exists for that last number more than the first two:
 * everything here is uncompressed WAV (see podcast-feed.ts's ENCLOSURE_MIME),
 * the whole file is assembled in memory before it is written, and the storage
 * it lands in is a local disk.
 *
 * An article past the limit is skipped entirely rather than truncated. A
 * truncated episode is the worse failure by a distance: it plays perfectly,
 * ends cleanly, and gives no indication that the listener just missed the
 * last third of the article.
 */
const MAX_EPISODE_CHUNKS = 250;

/**
 * How many missing episodes one feed fetch will start generating.
 *
 * Podcast clients poll every few hours forever, so the backlog gets worked
 * through across polls regardless -- there is nothing to gain from queueing
 * fifty articles at once, and something real to lose: each one holds its
 * assembled audio in memory while it builds.
 */
const MAX_GENERATIONS_PER_FETCH = 3;

/** Bounds guessing at the feed URL. The token itself makes brute force
 * hopeless, but this route is unauthenticated by construction and reachable
 * by anyone, so it should not also be free to hammer. Generous enough for a
 * household of clients polling on their own schedules. */
const FEED_LIMIT = { max: 120, timeWindow: "10 minutes" };

type FeedArticle = {
  id: string;
  title: string | null;
  author: string | null;
  siteName: string | null;
  url: string | null;
  excerpt: string | null;
  savedAt: Date;
  readingTimeEstimate: number | null;
  coverImageUrl: string | null;
  extractedText: string | null;
  audio: { storageKey: string; bytes: number; durationSeconds: number; voice: string; speed: number } | null;
};

/**
 * Which articles a given filter's feed would list, as one definition used by
 * both the fetch and the eviction pass.
 *
 * Shared rather than repeated because the two must not drift: eviction
 * deletes exactly what this does not select, so a clause added to one and not
 * the other deletes audio the feed is still advertising.
 */
function feedWindowWhere(userId: string, filter: PodcastFeedFilter): Prisma.ArticleWhereInput {
  return {
    userId,
    deletedAt: null,
    // No text means nothing to read aloud -- a failed extraction, or a
    // scanned PDF that never went through OCR. Filtered in the query rather
    // than after, so the item budget is spent on articles that can actually
    // become episodes.
    extractedText: { not: null },
    ...(filter === "queue" ? { status: { in: ["UNREAD", "READING"] } } : {}),
  };
}

const FEED_WINDOW_ORDER: Prisma.ArticleOrderByWithRelationInput[] = [{ savedAt: "desc" }, { id: "desc" }];

/**
 * Absolute base for the feed URL and every <enclosure> in it.
 *
 * These cannot be relative: the client resolving them is a podcast app on a
 * phone, not a browser sitting on the page. Deriving from the request's own
 * Host header is the right default (it is by definition the name the client
 * reached us on, which a hardcoded value would get wrong in dev, in Docker
 * and behind any proxy), but the scheme is the part that breaks: behind a
 * TLS-terminating proxy `request.protocol` is "http" unless TRUST_PROXY is
 * set, and an https feed handing out http enclosures is a downgrade that
 * iOS's ATS refuses to download at all. API_PUBLIC_URL is the explicit way
 * out of that for deployments that need it.
 */
function apiBaseUrl(request: FastifyRequest): string {
  const configured = process.env.API_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return `${request.protocol}://${request.headers.host}`;
}

function feedUrl(request: FastifyRequest, token: string, filter: PodcastFeedFilter): string {
  const query = filter === DEFAULT_PODCAST_FEED_FILTER ? "" : `?filter=${filter}`;
  return `${apiBaseUrl(request)}/podcast/${token}/feed.xml${query}`;
}

function enclosureUrl(request: FastifyRequest, token: string, articleId: string): string {
  return `${apiBaseUrl(request)}/podcast/${token}/episodes/${articleId}/audio.wav`;
}

/**
 * Resolves the token in the URL path to a user, or null.
 *
 * The scope check is not decoration: without it, any "blk_"-prefixed personal
 * access token's hash would also match a row here, so a read-only PAT
 * intended for a script would double as a full-library audio feed. Feed
 * access requires a row that was minted *as* a feed token, and POST
 * /api/tokens cannot mint one (PODCAST_FEED_SCOPE is not in its VALID_SCOPES).
 */
async function authenticateFeedToken(token: string): Promise<string | null> {
  if (!token.startsWith(FEED_TOKEN_PREFIX)) return null;
  const record = await prisma.apiToken.findUnique({ where: { tokenHash: hashApiToken(token) } });
  if (!record || record.revokedAt || !record.scopes.includes(PODCAST_FEED_SCOPE)) return null;
  // Fire-and-forget, same as context.ts: this is the only "is the feed
  // actually being fetched?" signal the settings page can show, and it is not
  // worth failing a request over.
  prisma.apiToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return record.userId;
}

function toStatus(row: { createdAt: Date; lastUsedAt: Date | null } | null): PodcastFeedStatus {
  return {
    enabled: row !== null,
    createdAt: row?.createdAt.toISOString() ?? null,
    lastFetchedAt: row?.lastUsedAt?.toISOString() ?? null,
  };
}

function findFeedToken(userId: string) {
  return prisma.apiToken.findFirst({
    where: { userId, revokedAt: null, scopes: { has: PODCAST_FEED_SCOPE } },
    orderBy: { createdAt: "desc" },
  });
}

// ---------- Enclosure generation ----------

/**
 * Whole-article audio is built strictly off the time-to-first-audio path, and
 * that is the acceptance criterion this section exists to satisfy.
 *
 * Two mechanisms, because either alone is insufficient:
 *
 * - Every chunk is enqueued with `speculative: true`, which puts it on
 *   tts-pool.ts's lowPriorityQueue. That queue is drained only when the
 *   normal queue is empty, so a listener pressing play never waits behind
 *   podcast work that has not started yet.
 *
 * - Chunks are generated one at a time, and only one article builds at a
 *   time (see `chain` below). Priority alone does not bound this: an article
 *   is hundreds of chunks, and firing them all at once would occupy every
 *   worker in the pool. Being low priority only decides who goes *next* --
 *   it cannot evict work already running in a worker. Serializing means at
 *   most one of POOL_SIZE workers is ever busy with podcast audio.
 *
 * What remains, stated honestly: on a single-worker pool (POOL_SIZE is
 * derived from core count, so a 1-vCPU host gets one), a play pressed while a
 * podcast chunk is mid-generation waits for that chunk to finish -- one
 * chunk, a few seconds, once. Bounding it further would mean the ability to
 * interrupt a running inference, which onnxruntime does not offer.
 */
let chain: Promise<unknown> = Promise.resolve();
/** Articles currently building, so two overlapping feed fetches (a phone and
 * a laptop polling at the same time) do not generate the same episode twice
 * and then race to write the row. */
const building = new Set<string>();

async function buildEpisodeAudio(userId: string, article: FeedArticle, log: FastifyBaseLogger): Promise<void> {
  const chunks = toSafeTextChunks(article.extractedText ?? "");
  if (chunks.length === 0 || chunks.length > MAX_EPISODE_CHUNKS) return;

  /**
   * The quota, checked here rather than at queue time for two reasons: builds
   * are serialized on `chain`, so this reading already includes whatever the
   * previous build in the same fetch just wrote, and refusing before the
   * first chunk is generated means an over-quota account costs no TTS work at
   * all rather than 40 minutes of inference thrown away at the end.
   *
   * Refusing is the whole action. Nothing existing is touched -- no row
   * rewritten, no file deleted, no half-written episode -- because the
   * over-quota state is nearly always transient: the next poll's eviction
   * pass frees whatever has left the window, and generation resumes on its
   * own. Deleting someone's oldest episodes to make room for a newer one is a
   * policy this has no business inventing while the feed still lists them.
   *
   * Accepted imprecision: an episode's size is not known until it is
   * assembled, so this admits any build that starts under the limit and can
   * therefore overshoot by at most one episode (~115 MB at
   * MAX_EPISODE_CHUNKS). Bounding growth is the point; exact accounting is
   * not worth a second check that throws away finished audio.
   */
  const used = await podcastAudioBytesUsed(userId, article.id);
  if (used >= PODCAST_AUDIO_QUOTA_BYTES) {
    log.warn(
      { userId, articleId: article.id, used, quota: PODCAST_AUDIO_QUOTA_BYTES },
      "[podcast] episode not generated: account is at its audio storage quota",
    );
    return;
  }

  const parts: Buffer[] = [];
  for (const chunk of chunks) {
    parts.push(await generateSpeechPooled(chunk, PODCAST_VOICE, PODCAST_SPEED, { speculative: true }));
  }

  const wav = concatPcm16Wavs(parts);
  const storageKey = await saveFile(userId, `${article.id}.wav`, wav);

  const previous = article.audio?.storageKey;
  await prisma.articleAudio.upsert({
    where: { articleId: article.id },
    create: {
      articleId: article.id,
      storageKey,
      bytes: wav.length,
      durationSeconds: pcm16WavDurationSeconds(wav),
      voice: PODCAST_VOICE,
      speed: PODCAST_SPEED,
    },
    update: {
      storageKey,
      bytes: wav.length,
      durationSeconds: pcm16WavDurationSeconds(wav),
      voice: PODCAST_VOICE,
      speed: PODCAST_SPEED,
      generatedAt: new Date(),
    },
  });

  // Only after the row points at the new file: deleting first would leave a
  // window where the feed advertises an enclosure whose bytes are gone.
  if (previous && previous !== storageKey) await deleteStoredFile(previous).catch(() => undefined);
}

function queueEpisodeAudio(userId: string, article: FeedArticle, log: FastifyBaseLogger): void {
  if (building.has(article.id)) return;
  building.add(article.id);
  chain = chain
    .then(() => buildEpisodeAudio(userId, article, log))
    .catch((err) => log.warn({ err, articleId: article.id }, "[podcast] episode generation failed"))
    .finally(() => building.delete(article.id));
}

/** Audio generated with a voice or speed the feed no longer uses is stale:
 * an episode list where the first ten items are one narrator and the rest are
 * another is worse than a short delay while they rebuild. */
function isCurrent(audio: FeedArticle["audio"]): boolean {
  return audio !== null && audio.voice === PODCAST_VOICE && audio.speed === PODCAST_SPEED;
}

// ---------- Routes ----------

export async function registerPodcastRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Mints a feed URL, replacing any existing one.
   *
   * The raw token is in the response and nowhere else -- only its hash is
   * stored, exactly like a personal access token, and for a stronger reason:
   * this URL is a bearer credential for the full audio of everything the
   * account has saved. Keeping a plaintext copy so the settings page could
   * re-display it would make a database dump equivalent to handing out every
   * user's library. The cost is that "show me my feed URL again" is
   * unavailable and regenerating (which invalidates the old URL, requiring a
   * resubscribe) is the only way back to it.
   *
   * The URL comes back with no ?filter, i.e. the queue. Choosing "all"
   * deliberately has no knob here: appending ?filter=all to the URL is
   * already the whole mechanism, and a mint-time copy of the same choice
   * would be a second place for it to be wrong without being a second thing
   * anyone can do.
   */
  app.post("/api/podcast/feed", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;

    // Revoked rather than deleted, and revoked before the new row exists, so
    // there is never a moment where two feed URLs both work -- "regenerate"
    // has to mean the leaked one stops working immediately.
    await prisma.apiToken.updateMany({
      where: { userId, revokedAt: null, scopes: { has: PODCAST_FEED_SCOPE } },
      data: { revokedAt: new Date() },
    });

    const token = generateFeedToken();
    const created = await prisma.apiToken.create({
      data: {
        userId,
        name: "Podcast feed",
        scopes: [PODCAST_FEED_SCOPE],
        tokenHash: hashApiToken(token),
      },
    });

    const body: PodcastFeedSecret = {
      ...toStatus(created),
      url: feedUrl(request, token, DEFAULT_PODCAST_FEED_FILTER),
    };
    return reply.code(201).send(body);
  });

  app.get("/api/podcast/feed", { preHandler: requireAuth }, async (request, reply) => {
    return reply.send(toStatus(await findFeedToken(request.userId!)));
  });

  app.delete("/api/podcast/feed", { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.userId!;
    const { count } = await prisma.apiToken.updateMany({
      where: { userId, revokedAt: null, scopes: { has: PODCAST_FEED_SCOPE } },
      data: { revokedAt: new Date() },
    });
    if (count === 0) return reply.code(404).send({ error: "not_found", message: "No podcast feed to turn off." });

    // Everything, because a poll is the only thing that evicts (see the feed
    // route) and this is the request that guarantees there will never be
    // another one. Without this, turning the feature off is the one way to
    // leave a full feed's worth of WAVs on the disk permanently -- the exact
    // shape of the S5 leak, reached by the button that means "stop".
    //
    // Re-enabling regenerates, three episodes per poll, the same as a first
    // subscribe. That is the right trade: the audio is a cache of text the
    // database still holds, and nothing here is the only copy of anything.
    //
    // One episode can still slip past: a build already running on `chain`
    // writes its row after this returns. It is bounded by one file, and the
    // first poll after re-enabling collects it. Cancelling a running
    // generation would need an interrupt onnxruntime does not offer -- the
    // same limitation buildEpisodeAudio's header describes.
    await evictEpisodesOutsideFeed(userId, new Set(), request.log).catch((err) => {
      request.log.warn({ err, userId }, "[podcast] episode eviction failed after turning the feed off");
    });

    return reply.code(204).send();
  });

  /**
   * The feed itself. Unauthenticated in the session sense -- the token in the
   * path is the whole credential, because a podcast client can send nothing
   * else: no cookies, no OAuth, no Authorization header you can configure.
   *
   * That is also why a bad token gets 404 rather than 401: 401 invites a
   * client to prompt for credentials it has no way to supply, and there is
   * nothing here for an unauthenticated caller to discover the existence of.
   */
  app.get<{ Params: { token: string } }>(
    "/podcast/:token/feed.xml",
    { config: { rateLimit: FEED_LIMIT } },
    async (request, reply) => {
      const userId = await authenticateFeedToken(request.params.token);
      if (!userId) return reply.code(404).send({ error: "not_found", message: "No such feed." });

      const { filter: rawFilter } = request.query as { filter?: string };
      const filter = isPodcastFeedFilter(rawFilter) ? rawFilter : DEFAULT_PODCAST_FEED_FILTER;

      const articles: FeedArticle[] = await prisma.article.findMany({
        where: feedWindowWhere(userId, filter),
        orderBy: FEED_WINDOW_ORDER,
        take: MAX_FEED_ITEMS,
        select: {
          id: true,
          title: true,
          author: true,
          siteName: true,
          url: true,
          excerpt: true,
          savedAt: true,
          readingTimeEstimate: true,
          coverImageUrl: true,
          extractedText: true,
          audio: { select: { storageKey: true, bytes: true, durationSeconds: true, voice: true, speed: true } },
        },
      });

      /**
       * Only articles whose audio is ready become items.
       *
       * An <item> with no <enclosure> is not a podcast episode -- clients
       * either drop it silently or, worse, list it as an episode that fails
       * to play with no explanation. An article that is simply absent from
       * this poll and present in the next one is the behaviour a podcast
       * client is built around, so a first subscribe legitimately shows an
       * empty or partial feed while the backlog generates.
       */
      const episodes: PodcastEpisodeInput[] = [];
      const missing: FeedArticle[] = [];
      for (const article of articles) {
        if (isCurrent(article.audio)) {
          episodes.push({
            articleId: article.id,
            title: article.title,
            author: article.author,
            siteName: article.siteName,
            link: article.url,
            savedAt: article.savedAt,
            readingTimeEstimate: article.readingTimeEstimate,
            excerpt: article.excerpt,
            coverImageUrl: article.coverImageUrl,
            audioUrl: enclosureUrl(request, request.params.token, article.id),
            audioBytes: article.audio!.bytes,
            audioDurationSeconds: article.audio!.durationSeconds,
          });
        } else {
          missing.push(article);
        }
      }

      for (const article of missing.slice(0, MAX_GENERATIONS_PER_FETCH)) {
        queueEpisodeAudio(userId, article, request.log);
      }

      /**
       * Eviction (audit S5): audio for articles this poll did not list is
       * deleted, rows and files both.
       *
       * A poll is the only clock this app has -- there is no background
       * worker, which is why articles.ts's purgeExpiredTrash piggybacks on a
       * read too -- and here it is also the right one: which articles are
       * advertisable changes exactly when someone asks, so the disk is
       * reconciled exactly when the answer changes.
       *
       * The keep set is the window just served. Scoping it to the *fetched*
       * filter is the decision worth stating, because the alternative was
       * tempting: one token serves both `feed.xml` and `feed.xml?filter=all`,
       * so keeping the union of both windows would stop two differently
       * filtered clients on one token from deleting and regenerating each
       * other's episodes. It was rejected. Under the union, archiving an
       * article frees nothing -- it is still inside the top-MAX_FEED_ITEMS
       * `all` window for however many weeks it takes newer saves to push it
       * out -- so the default subscriber, who has one URL and reads their
       * queue, keeps every finished episode and stores twice as much. That is
       * the case the audit is about. The two-filter case is a deliberate,
       * unusual configuration and it degrades in CPU (low-priority
       * regeneration, three per poll) rather than in disk.
       *
       * `building` is folded in because a queued generation is about to write
       * a row for an article that a concurrent poll's window may not contain;
       * evicting it there would delete the row moments before it exists and
       * orphan the file the build then writes.
       *
       * Awaited rather than fired and forgotten: in steady state it is one
       * indexed query returning nothing, and a poll that returns before the
       * disk is reconciled makes "how much is stored" depend on scheduling.
       * Best-effort all the same -- a feed that 500s because an unlink failed
       * would be a worse bug than the leak it is fixing.
       */
      const keep = new Set<string>([...articles.map((article) => article.id), ...building]);
      await evictEpisodesOutsideFeed(userId, keep, request.log).catch((err) => {
        request.log.warn({ err, userId }, "[podcast] episode eviction failed");
      });

      const xml = buildPodcastFeedXml({
        title: "Booklet — your reading queue",
        description:
          "Articles saved to Booklet, read aloud. Playback position does not sync back — " +
          "podcast clients have no way to report it.",
        selfUrl: feedUrl(request, request.params.token, filter),
        siteUrl: process.env.WEB_ORIGIN ?? "http://localhost:3000",
        authorName: "Booklet",
        // Unset by default: see PodcastChannelInput.artworkUrl. Point it at a
        // 1400x1400+ JPEG/PNG to satisfy Apple's requirement.
        artworkUrl: process.env.PODCAST_ARTWORK_URL ?? null,
        buildDate: new Date(),
        episodes,
      });

      return reply
        .type("application/rss+xml; charset=utf-8")
        // The document contains the secret feed URL in <atom:link rel="self">
        // and one per enclosure, so it must never sit in a shared cache.
        .header("Cache-Control", "private, max-age=300")
        .send(xml);
    },
  );

  /**
   * One episode's audio. Authenticated by the same token as the feed, so a
   * revoked feed takes its enclosures with it -- a client that cached the
   * episode list cannot keep downloading from an invalidated URL.
   */
  app.get<{ Params: { token: string; articleId: string } }>(
    "/podcast/:token/episodes/:articleId/audio.wav",
    { config: { rateLimit: FEED_LIMIT } },
    async (request, reply) => {
      const userId = await authenticateFeedToken(request.params.token);
      if (!userId) return reply.code(404).send({ error: "not_found", message: "No such feed." });

      const article = await prisma.article.findFirst({
        where: { id: request.params.articleId, userId, deletedAt: null },
        select: { id: true, audio: true },
      });
      if (!article) return reply.code(404).send({ error: "not_found", message: "No such episode." });
      if (!article.audio) {
        // 503 rather than 404 for an episode that exists but has not been
        // generated yet: a client that gets a 404 marks the download
        // permanently failed and stops asking, while 503 + Retry-After is
        // exactly the "come back later" this is. Reachable when a client
        // holds a feed from before the audio was rebuilt.
        return reply
          .code(503)
          .header("Retry-After", "600")
          .send({ error: "not_ready", message: "This episode's audio is still being generated." });
      }

      // reply.hijack() + piping to reply.raw, for the same reason as
      // articles.ts's /file route -- reply.send() with a plain fs ReadStream
      // was found to hang there. No CORS headers to set by hand here, unlike
      // that route: this is fetched by native podcast clients and by
      // top-level browser navigation, neither of which is a cross-origin XHR.
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "audio/wav",
        "Content-Length": String(article.audio.bytes),
        // Range is deliberately unadvertised: storage-service exposes no
        // offset read, so honouring one would mean buffering the whole file
        // (up to ~115 MB) to slice it. Podcast clients download the enclosure
        // whole and seek locally, so this costs nothing they actually do.
        "Accept-Ranges": "none",
        // The file is written once per generation and replaced by key, never
        // edited in place, so a client that has it never needs to revalidate.
        "Cache-Control": "private, max-age=31536000, immutable",
      });
      const stream = streamStoredFile(article.audio.storageKey);
      stream.on("error", () => reply.raw.destroy());
      stream.pipe(reply.raw);
    },
  );
}
