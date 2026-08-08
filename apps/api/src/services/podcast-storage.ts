import type { FastifyBaseLogger } from "fastify";
import { prisma } from "../lib/prisma.js";
import { deleteStoredFile } from "./storage-service.js";

/**
 * Disk accounting for generated podcast episodes (#154), and the answer to
 * pre-deployment audit finding S5.
 *
 * podcast.ts already bounds one episode (MAX_EPISODE_CHUNKS, ~115 MB) and one
 * poll (MAX_GENERATIONS_PER_FETCH). What was missing is the ceiling above
 * those two: a feed lists up to 50 items, a podcast client polls forever, and
 * nothing ever deleted an ArticleAudio file once its article stopped being
 * advertised. One subscriber with an ordinary reading queue converges on 50
 * stored WAVs -- 1-2 GB in practice, 5.75 GB if every one of them is a
 * long-read -- on the same mounted disk that holds every user's uploaded PDFs
 * and EPUBs. Ten subscribers fill a 20 GB volume, and what fails after that is
 * not the podcast feed: it is uploads, with ENOSPC, in a route that writes the
 * file before the row commits.
 *
 * Two mechanisms here, in the order they matter:
 *
 * 1. evictEpisodesOutsideFeed -- the actual fix. Bytes stop accumulating
 *    because audio nobody can be served is deleted, so steady state is
 *    "roughly the feed window", not "everything ever generated".
 * 2. podcastAudioBytesUsed / PODCAST_AUDIO_QUOTA_BYTES -- belt and braces for
 *    the cases eviction cannot bound: 50 episodes that all happen to be
 *    40-minute long-reads is inside the window and still 5.75 GB.
 *
 * Deliberately NOT here: encoding the enclosures as MP3 or Opus. It is the
 * right thing (~10x smaller, and what podcast clients expect on cellular --
 * see docs/ROADMAP.md), it needs a codec dependency, and #153 already owns
 * that work. It is also not a substitute for any of this: compression changes
 * how fast an unbounded set of files fills a disk, not whether it does.
 */

/** 2 GiB of generated audio per account.
 *
 * Chosen against the two numbers that bracket it, not picked round. WAV here
 * is 24 kHz mono 16-bit, i.e. ~2.9 MB per minute of speech, so a typical
 * article episode is 15-40 MB and a converged 50-item feed is ~1.2 GB. The
 * pathological one -- 50 articles all at the MAX_EPISODE_CHUNKS ceiling -- is
 * 5.75 GB. A quota below ~1.5 GB would fire during normal use, which is the
 * worst outcome available: generation stops, the feed silently stalls with
 * items that never gain an enclosure, and nothing tells the user why. 2 GiB
 * sits above every normal case and well below the pathological one, so
 * reaching it means something genuinely unusual.
 *
 * Overridable because the right value is a property of the disk, not of the
 * app: a 20 GB volume shared by ten accounts wants a smaller number than this
 * default, and there is no way for the code to know which it is on.
 */
function readQuotaBytes(): number {
  const configured = Number(process.env.PODCAST_AUDIO_QUOTA_BYTES);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return 2 * 1024 * 1024 * 1024;
}

export const PODCAST_AUDIO_QUOTA_BYTES = readQuotaBytes();

/**
 * Bytes of generated episode audio this account is currently holding on disk.
 *
 * `excludeArticleId` is for the regeneration case: rebuilding an episode
 * because the voice changed replaces one file with another and deletes the
 * old one, so counting the old bytes against the new build would refuse a
 * rebuild that consumes nothing.
 *
 * Summed from ArticleAudio.bytes rather than stat()ing the directory: the
 * rows are what the feed serves, and a byte on disk with no row pointing at
 * it is an orphan that no amount of refusing to generate will reclaim.
 */
export async function podcastAudioBytesUsed(userId: string, excludeArticleId?: string): Promise<number> {
  const { _sum } = await prisma.articleAudio.aggregate({
    _sum: { bytes: true },
    where: {
      article: { userId },
      ...(excludeArticleId ? { articleId: { not: excludeArticleId } } : {}),
    },
  });
  return _sum.bytes ?? 0;
}

/**
 * Deletes episode audio for articles this user's feed can no longer advertise.
 *
 * `keepArticleIds` is the window the caller just served, plus anything mid
 * generation -- see podcast.ts for why it is that window and not a wider one.
 * Anything else has left: read or archived out of the queue, pushed past
 * MAX_FEED_ITEMS by newer saves, or trashed (the feed query filters
 * `deletedAt: null`, so a trashed article's enclosure is already unreachable
 * and its bytes are pure loss).
 *
 * Keys first, rows second, files third -- the same order as `DELETE
 * /api/auth/me` and articles.ts's deleteArticleFiles, and for the same
 * reason: ArticleAudio.storageKey is the only record of where those bytes
 * live, so deleting the row first makes the file unreachable forever.
 *
 * The file deletes are best-effort per key, again matching those two. A
 * failed unlink is one orphaned file, which is what this whole module exists
 * to bound; failing the poll over it would trade a leaked file for a broken
 * feed.
 *
 * ---
 *
 * The race this deliberately accepts: a client that holds a feed document
 * from an earlier poll and starts downloading an enclosure whose article has
 * since left the window.
 *
 * A download already in flight is unaffected -- deleteStoredFile is rm(),
 * POSIX unlink keeps the inode alive for the open read stream, and the
 * response finishes with the bytes it promised. Only a request that has not
 * started yet can lose, and it loses gracefully: the Article row survives
 * (only ArticleAudio is deleted), so the enclosure route takes its existing
 * `no audio yet` branch and answers 503 + Retry-After rather than 404. That
 * is the difference between a client that retries and one that marks the
 * episode permanently failed -- and on that retry the item is simply gone
 * from the feed, which is the one thing every podcast client handles
 * correctly.
 *
 * A grace period on ArticleAudio.generatedAt was considered and rejected: it
 * protects freshly generated audio, and the audio at risk here is old --
 * generated days ago, advertised for days, and evicted the moment its article
 * was marked read. The clock that would actually close this race is "when was
 * this last advertised", which no column records. That is a schema change
 * (ArticleAudio.lastAdvertisedAt, written on every feed fetch, evicted after
 * a poll interval or two of not being listed) and it is reported rather than
 * made here.
 */
export async function evictEpisodesOutsideFeed(
  userId: string,
  keepArticleIds: ReadonlySet<string>,
  log: FastifyBaseLogger,
): Promise<number> {
  const departed = await prisma.articleAudio.findMany({
    where: {
      article: { userId },
      // Prisma renders an empty `notIn` as a tautology rather than a no-op,
      // which is the behaviour wanted here anyway (an empty feed keeps
      // nothing), but spelling it out beats relying on that.
      ...(keepArticleIds.size > 0 ? { articleId: { notIn: [...keepArticleIds] } } : {}),
    },
    select: { articleId: true, storageKey: true, bytes: true },
  });
  if (departed.length === 0) return 0;

  await prisma.articleAudio.deleteMany({ where: { articleId: { in: departed.map((row) => row.articleId) } } });

  await Promise.all(
    departed.map((row) =>
      deleteStoredFile(row.storageKey).catch((err) =>
        log.warn({ err, key: row.storageKey }, "[podcast] orphaned episode file after eviction"),
      ),
    ),
  );

  log.info(
    { userId, episodes: departed.length, bytes: departed.reduce((total, row) => total + row.bytes, 0) },
    "[podcast] evicted episodes that left the feed window",
  );
  return departed.length;
}
