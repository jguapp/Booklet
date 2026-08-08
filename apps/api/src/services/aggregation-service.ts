import { createHash } from "node:crypto";
import type { OnboardingSeedsResponse, SeedCollection, SeedHighlight } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { PUBLIC_DOMAIN_SEED_COLLECTIONS } from "../data/public-domain-seeds.js";

/**
 * The cross-user "what do Booklet readers highlight" aggregate (#158 part 2)
 * and the onboarding seeds it feeds.
 *
 * Two conditions gate every passage, and both must hold:
 *
 * 1. The highlight is already public -- it sits on an article (or on an
 *    article in a collection) that its owner shared via part 1.
 * 2. The owner separately turned on User.contributesToPublicHighlights.
 *
 * Requiring both is the whole point. Someone who published one page so a
 * friend could read their notes on one essay has not agreed to have their
 * reading mined across the product, and someone who ticks the contribute box
 * has not agreed to have their *private* library counted either.
 */

/**
 * How many distinct accounts must have highlighted a passage before it can
 * surface anywhere.
 *
 * Three, for two reasons. The issue's own example ("3 users highlighted
 * this") is the shape of claim this is allowed to make, and 3 is the low end
 * of the small-cell-suppression convention that statistical disclosure
 * control has used for decades: a cell backed by one or two units is not an
 * aggregate, it is those units with a count printed next to them. At a
 * threshold of 1 this table would literally be a republication of individual
 * libraries; at 2, an attacker who is themselves one of the two contributors
 * learns that exactly one other account highlighted a specific passage,
 * which combined with knowing who they shared a page with is a real
 * membership inference. At 3 an attacker must control two colluding accounts
 * that both highlighted the identical passage to learn only that some third,
 * unnamed account did too -- and this table stores no user ids, so even then
 * there is nothing to look up.
 *
 * This is a floor, not a target. It should be raised as the user base grows;
 * 3 is calibrated for the smallest population where the feature can run at
 * all, not for a large one.
 */
export const MIN_DISTINCT_USERS = 3;

/**
 * Passages shorter than this are excluded. A four-word highlight ("this is
 * the key") collides across completely unrelated books, so a count against
 * it is meaningless -- and it makes a terrible seed regardless, since it
 * reads as nothing without its surrounding page.
 */
export const MIN_PASSAGE_CHARS = 40;

/**
 * And longer than this are excluded, for the same copyright reason the
 * shared page never publishes extracted body text: someone who highlights
 * three pages at once has produced a substantial reproduction of the
 * original, not an excerpt, and this table republishes its contents to
 * accounts that have nothing to do with the source.
 */
export const MAX_PASSAGE_CHARS = 600;

/** How many community passages the onboarding response carries. Enough to
 * fill a screen, few enough that the weakest ones never appear. */
const COMMUNITY_SEED_LIMIT = 12;

/**
 * Collapses the incidental differences between two people highlighting the
 * same sentence -- a trailing comma caught in the selection, curly vs.
 * straight quotes, a line break that came through as a space -- so those
 * count as one passage instead of three near-misses that each stay below the
 * threshold.
 */
export function normalizePassage(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}

/**
 * Hashed rather than keyed on the normalized text directly because a
 * Postgres btree unique index refuses values past ~2700 bytes, and a
 * highlight is free-form text with no such bound -- the index would have
 * worked in testing and then thrown on somebody's long quotation in
 * production.
 */
export function passageHash(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

/** Whitespace-collapsed but otherwise untouched -- what gets displayed, as
 * opposed to the lowercased form used for matching. */
function displayText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface Bucket {
  text: string;
  users: Set<string>;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceAuthor: string | null;
}

/**
 * Rebuilds PublicHighlightStat from scratch.
 *
 * A full rebuild rather than incremental counters, because every input is
 * revocable: unsharing a page, deleting a highlight, trashing an article, or
 * turning the contribute switch back off all have to *decrement* the
 * aggregate, and a counter that only ever went up would quietly keep
 * publishing passages whose owners had withdrawn them. Recomputing is the
 * only version where withdrawal is guaranteed to take effect.
 *
 * Cheap at this app's scale (it reads only highlights that are both public
 * and opted in, which is a small fraction of a small table). When that stops
 * being true it wants to be a queued job rather than an incremental
 * counter -- the correctness argument above doesn't change.
 */
export async function recomputePublicHighlightStats(): Promise<{ passages: number }> {
  const rows = await prisma.highlight.findMany({
    where: {
      // Condition 2: the opt-in.
      user: { contributesToPublicHighlights: true },
      article: {
        // A trashed article's highlights stop counting immediately, matching
        // what its shared page does (see shares.ts).
        deletedAt: null,
        // Condition 1: already public. `shares: { some: {} }` is an exact
        // test for "currently shared" only because revocation deletes the
        // Share row rather than flipping a flag -- with a soft delete this
        // clause would have needed to know about the flag, and forgetting to
        // would have kept mining a revoked page.
        OR: [
          { shares: { some: {} } },
          { collections: { some: { collection: { shares: { some: {} } } } } },
        ],
      },
    },
    select: {
      userId: true,
      selectedText: true,
      article: { select: { title: true, author: true, url: true } },
    },
  });

  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const text = displayText(row.selectedText);
    if (text.length < MIN_PASSAGE_CHARS || text.length > MAX_PASSAGE_CHARS) continue;

    const normalized = normalizePassage(text);
    if (!normalized) continue;
    const hash = passageHash(normalized);

    const bucket = buckets.get(hash);
    if (bucket) {
      bucket.users.add(row.userId);
      continue;
    }
    buckets.set(hash, {
      text,
      // A Set of user ids, held only for the length of this function and
      // never written anywhere -- what lands in Postgres is `users.size`.
      users: new Set([row.userId]),
      sourceTitle: row.article.title,
      sourceUrl: row.article.url,
      sourceAuthor: row.article.author,
    });
  }

  const kept = [...buckets.entries()].filter(([, b]) => b.users.size >= MIN_DISTINCT_USERS);

  // The threshold is enforced here, at write time, and not only in the read
  // query. A read-side-only filter leaves every one-person passage sitting
  // in the table, one forgotten where-clause away from being served -- so
  // sub-threshold passages are never stored in the first place.
  for (const [textHash, bucket] of kept) {
    const data = {
      text: bucket.text,
      sourceTitle: bucket.sourceTitle,
      sourceUrl: bucket.sourceUrl,
      sourceAuthor: bucket.sourceAuthor,
      userCount: bucket.users.size,
      lastSeenAt: new Date(),
    };
    await prisma.publicHighlightStat.upsert({
      where: { textHash },
      create: { textHash, ...data },
      update: data,
    });
  }

  // Anything that no longer qualifies -- unshared, opted out, deleted, or
  // fallen back below the threshold -- goes away rather than lingering at
  // its last known count.
  const keptHashes = kept.map(([hash]) => hash);
  if (keptHashes.length === 0) {
    await prisma.publicHighlightStat.deleteMany({});
  } else {
    await prisma.publicHighlightStat.deleteMany({ where: { textHash: { notIn: keptHashes } } });
  }

  return { passages: keptHashes.length };
}

/**
 * The community half of the seeds. Re-applies the threshold on read even
 * though nothing below it is ever stored -- belt and braces on the one query
 * whose output is served to anyone with the URL.
 */
export async function getCommunitySeeds(limit = COMMUNITY_SEED_LIMIT): Promise<SeedHighlight[]> {
  const rows = await prisma.publicHighlightStat.findMany({
    where: { userCount: { gte: MIN_DISTINCT_USERS } },
    orderBy: [{ userCount: "desc" }, { lastSeenAt: "desc" }],
    take: limit,
  });

  return rows.map((row) => ({
    text: row.text,
    sourceTitle: row.sourceTitle ?? "Untitled",
    sourceAuthor: row.sourceAuthor,
    sourceUrl: row.sourceUrl,
    origin: "community" as const,
    highlightedBy: row.userCount,
  }));
}

/**
 * What a new (or signed-out) reader is offered on day one.
 *
 * Community passages lead when there are any, because a passage three real
 * readers stopped on is a better recommendation than anything hand-picked --
 * but the public-domain set is always appended, not used as a fallback. With
 * an empty aggregate it is the entire feature, and with a healthy one it
 * still covers everything the aggregate has no data on.
 */
export async function getOnboardingSeeds(): Promise<OnboardingSeedsResponse> {
  const community = await getCommunitySeeds();

  const collections: SeedCollection[] = [];
  if (community.length > 0) {
    collections.push({
      id: "community-most-highlighted",
      title: "Most highlighted by Booklet readers",
      description: `Passages at least ${MIN_DISTINCT_USERS} readers marked, from pages they chose to publish. No names attached — the counts are all this knows.`,
      highlights: community,
    });
  }
  collections.push(...PUBLIC_DOMAIN_SEED_COLLECTIONS);

  return { collections };
}
