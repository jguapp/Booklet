import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import {
  MIN_DISTINCT_USERS,
  MIN_PASSAGE_CHARS,
  getOnboardingSeeds,
  normalizePassage,
  passageHash,
  recomputePublicHighlightStats,
} from "../services/aggregation-service.js";
import { PUBLIC_DOMAIN_SEED_COLLECTIONS } from "../data/public-domain-seeds.js";

const EMAIL_PREFIX = `vitest-agg-${Date.now()}`;

/** Long enough to clear MIN_PASSAGE_CHARS, and distinctive enough that no
 * other test's data can collide with its hash. */
const SHARED_PASSAGE =
  "Attention is the rarest and purest form of generosity, or so the aggregation test insists.";

interface Contributor {
  userId: string;
  articleId: string;
}

/** One account with one article, one highlight, and the two switches this
 * feature gates on set independently -- which is the whole thing under test. */
async function makeContributor(
  index: number,
  options: { optedIn: boolean; shared: boolean; text?: string },
): Promise<Contributor> {
  const user = await prisma.user.create({
    data: {
      email: `${EMAIL_PREFIX}-${index}@test.local`,
      passwordHash: "not-a-real-hash",
      contributesToPublicHighlights: options.optedIn,
    },
  });
  const article = await prisma.article.create({
    data: { userId: user.id, title: "Shared Source", author: "A. Writer", url: "https://example.com/source" },
  });
  await prisma.highlight.create({
    data: {
      articleId: article.id,
      userId: user.id,
      selectedText: options.text ?? SHARED_PASSAGE,
      position: { type: "text" },
      color: "YELLOW",
    },
  });
  if (options.shared) {
    await prisma.share.create({
      data: { userId: user.id, articleId: article.id, slug: `test-slug-${EMAIL_PREFIX}-${index}` },
    });
  }
  return { userId: user.id, articleId: article.id };
}

function statForSharedPassage() {
  return prisma.publicHighlightStat.findUnique({
    where: { textHash: passageHash(normalizePassage(SHARED_PASSAGE)) },
  });
}

describe("cross-user highlight aggregation (#158 part 2)", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await recomputePublicHighlightStats();
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await prisma.publicHighlightStat.deleteMany({});
  });

  describe("normalization", () => {
    it("treats incidental differences in the same sentence as one passage", () => {
      const a = normalizePassage("  “The  same\nsentence,”  he said. ");
      const b = normalizePassage('"the same sentence," he said');
      expect(a).toBe(b);
      expect(passageHash(a)).toBe(passageHash(b));
    });

    it("keeps genuinely different sentences apart", () => {
      expect(normalizePassage("the same sentence")).not.toBe(normalizePassage("a different sentence"));
    });
  });

  describe("the opt-in", () => {
    it("counts nothing from accounts that only shared, without opting in", async () => {
      for (let i = 0; i < MIN_DISTINCT_USERS; i++) {
        await makeContributor(i, { optedIn: false, shared: true });
      }
      await recomputePublicHighlightStats();

      // Sharing a page for a friend is not consent to be mined for everyone.
      expect(await statForSharedPassage()).toBeNull();
    });

    it("counts nothing from accounts that opted in but published nothing", async () => {
      for (let i = 0; i < MIN_DISTINCT_USERS; i++) {
        await makeContributor(i, { optedIn: true, shared: false });
      }
      await recomputePublicHighlightStats();

      // The opt-in covers already-public highlights only -- it is not a
      // grant over the rest of a private library.
      expect(await statForSharedPassage()).toBeNull();
    });

    it("drops a contributor's passages the moment they opt back out", async () => {
      const contributors: Contributor[] = [];
      for (let i = 0; i < MIN_DISTINCT_USERS; i++) {
        contributors.push(await makeContributor(i, { optedIn: true, shared: true }));
      }
      await recomputePublicHighlightStats();
      expect(await statForSharedPassage()).not.toBeNull();

      await prisma.user.update({
        where: { id: contributors[0].userId },
        data: { contributesToPublicHighlights: false },
      });
      await recomputePublicHighlightStats();

      // Down to MIN_DISTINCT_USERS - 1, so the row is deleted rather than
      // kept at a lower count -- withdrawal has to actually withdraw.
      expect(await statForSharedPassage()).toBeNull();
    });

    it("drops a contributor's passages the moment their page is unshared", async () => {
      for (let i = 0; i < MIN_DISTINCT_USERS; i++) {
        await makeContributor(i, { optedIn: true, shared: true });
      }
      await recomputePublicHighlightStats();
      expect(await statForSharedPassage()).not.toBeNull();

      await prisma.share.deleteMany({ where: { slug: `test-slug-${EMAIL_PREFIX}-0` } });
      await recomputePublicHighlightStats();
      expect(await statForSharedPassage()).toBeNull();
    });
  });

  describe("the threshold", () => {
    it("surfaces nothing below MIN_DISTINCT_USERS, however public and opted in", async () => {
      for (let i = 0; i < MIN_DISTINCT_USERS - 1; i++) {
        await makeContributor(i, { optedIn: true, shared: true });
      }
      await recomputePublicHighlightStats();

      // Not merely hidden from the read query -- never written at all, so a
      // future query that forgets the where-clause has nothing to expose.
      expect(await statForSharedPassage()).toBeNull();
      expect(await prisma.publicHighlightStat.count()).toBe(0);
    });

    it("surfaces the passage with a count, once enough distinct accounts have it", async () => {
      for (let i = 0; i < MIN_DISTINCT_USERS; i++) {
        await makeContributor(i, { optedIn: true, shared: true });
      }
      await recomputePublicHighlightStats();

      const stat = await statForSharedPassage();
      expect(stat?.userCount).toBe(MIN_DISTINCT_USERS);
      expect(stat?.sourceTitle).toBe("Shared Source");
      expect(stat?.sourceUrl).toBe("https://example.com/source");
    });

    it("does not let one account reach the threshold by highlighting the same line repeatedly", async () => {
      const first = await makeContributor(0, { optedIn: true, shared: true });
      for (let i = 0; i < MIN_DISTINCT_USERS + 2; i++) {
        await prisma.highlight.create({
          data: {
            articleId: first.articleId,
            userId: first.userId,
            selectedText: SHARED_PASSAGE,
            position: { type: "text" },
            color: "YELLOW",
          },
        });
      }
      await recomputePublicHighlightStats();

      // The count is distinct *accounts*; anything else would let a single
      // library push its own passages into everyone's onboarding.
      expect(await statForSharedPassage()).toBeNull();
    });

    it("ignores passages too short to mean anything on their own", async () => {
      const short = "Yes, exactly.";
      expect(short.length).toBeLessThan(MIN_PASSAGE_CHARS);
      for (let i = 0; i < MIN_DISTINCT_USERS; i++) {
        await makeContributor(i, { optedIn: true, shared: true, text: short });
      }
      await recomputePublicHighlightStats();

      expect(
        await prisma.publicHighlightStat.findUnique({ where: { textHash: passageHash(normalizePassage(short)) } }),
      ).toBeNull();
    });
  });

  describe("what the aggregate stores", () => {
    it("holds no user ids, no highlight ids, and no article ids", async () => {
      const contributors: Contributor[] = [];
      for (let i = 0; i < MIN_DISTINCT_USERS; i++) {
        contributors.push(await makeContributor(i, { optedIn: true, shared: true }));
      }
      await recomputePublicHighlightStats();

      const stat = await statForSharedPassage();
      const serialized = JSON.stringify(stat);
      for (const { userId, articleId } of contributors) {
        expect(serialized).not.toContain(userId);
        expect(serialized).not.toContain(articleId);
      }
      // "3 readers highlighted this" is the strongest claim this table can
      // make, because a count is the only thing in it.
      expect(Object.keys(stat!).sort()).toEqual(
        ["id", "lastSeenAt", "sourceAuthor", "sourceTitle", "sourceUrl", "text", "textHash", "userCount"].sort(),
      );
    });
  });

  describe("onboarding seeds", () => {
    it("has something worth reading with an empty aggregate, which is the day-one case", async () => {
      const { collections } = await getOnboardingSeeds();

      expect(collections.every((c) => c.highlights.length > 0)).toBe(true);
      expect(collections.flatMap((c) => c.highlights).every((h) => h.origin === "public-domain")).toBe(true);
      expect(collections.flatMap((c) => c.highlights).length).toBeGreaterThanOrEqual(12);
    });

    it("leads with community passages once the aggregate has any, and keeps the seeds behind them", async () => {
      for (let i = 0; i < MIN_DISTINCT_USERS; i++) {
        await makeContributor(i, { optedIn: true, shared: true });
      }
      await recomputePublicHighlightStats();

      const { collections } = await getOnboardingSeeds();
      expect(collections[0].id).toBe("community-most-highlighted");
      expect(collections[0].highlights[0]).toMatchObject({
        text: SHARED_PASSAGE,
        origin: "community",
        highlightedBy: MIN_DISTINCT_USERS,
      });
      // The hand-picked set is appended, never replaced: the aggregate has
      // no data on most topics even when it is healthy.
      expect(collections.length).toBe(PUBLIC_DOMAIN_SEED_COLLECTIONS.length + 1);
    });
  });

  describe("the checked-in public-domain seeds", () => {
    it("attributes every passage", () => {
      for (const collection of PUBLIC_DOMAIN_SEED_COLLECTIONS) {
        for (const highlight of collection.highlights) {
          expect(highlight.sourceTitle.length, highlight.text).toBeGreaterThan(0);
          expect(highlight.sourceAuthor?.length ?? 0, highlight.text).toBeGreaterThan(0);
          // A passage with no link back is a quotation-site quote, which is
          // where misattributions come from.
          expect(highlight.sourceUrl, highlight.text).toMatch(/^https:\/\//);
          expect(highlight.origin).toBe("public-domain");
        }
      }
    });

    it("carries no duplicate passages and no duplicate collection ids", () => {
      const texts = PUBLIC_DOMAIN_SEED_COLLECTIONS.flatMap((c) => c.highlights.map((h) => normalizePassage(h.text)));
      expect(new Set(texts).size).toBe(texts.length);

      const ids = PUBLIC_DOMAIN_SEED_COLLECTIONS.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});

describe("the public seeds endpoint", () => {
  // Its own describe rather than a shared beforeAll: this one only needs the
  // app, and building it for the pure-function tests above would be waste.
  let app: Awaited<ReturnType<typeof import("../app.js").buildApp>>;

  beforeAll(async () => {
    const { buildApp } = await import("../app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves seeds to a request with no session, since day one is before signup", async () => {
    const res = await app.inject({ method: "GET", url: "/api/public/seeds" });
    expect(res.statusCode).toBe(200);
    expect(res.json().collections.length).toBeGreaterThan(0);
  });
});
