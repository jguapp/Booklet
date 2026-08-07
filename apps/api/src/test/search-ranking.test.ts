import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SearchResponse } from "@booklet/shared";
import { SNIPPET_MARK_START } from "@booklet/shared";
import { buildApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

/**
 * Ranked full-text search (#155). These assert the four things the old
 * `contains` implementation could not do, rather than that search returns
 * something -- each one fails against that version:
 *
 *   - multi-word queries whose terms are not adjacent
 *   - ranking, so the best match is first rather than the most recently saved
 *   - stemming
 *   - snippets that show why a result matched
 *
 * Fixtures are written straight through Prisma rather than the save route, so
 * these never touch the network or the extraction pipeline. searchVector is a
 * generated column, so it populates itself on insert -- there is nothing to
 * keep in sync here, which is the point of generating it in the database.
 */
describe("GET /api/search - ranking, stemming, snippets", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let userId: string;
  const email = `search-ranking-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await buildApp();

    const signup = await app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { email, password: "correct horse battery staple", name: "Search Ranking" },
    });
    expect(signup.statusCode).toBe(201);
    accessToken = signup.json().accessToken;
    userId = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

    await prisma.article.createMany({
      data: [
        {
          // The terms are in the *title*, and this is the OLDEST row -- so
          // savedAt ordering would put it last. It has to come first.
          id: `${userId}-title-hit`,
          userId,
          title: "Deep work and flow state",
          excerpt: "On sustained attention",
          extractedText: "Runners run every morning to build the habit.",
          sourceType: "HTML",
          extractionStatus: "SUCCESS",
          savedAt: new Date("2020-01-01"),
        },
        {
          // Same terms, but buried in the body and far apart, on a NEWER row.
          id: `${userId}-body-hit`,
          userId,
          title: "Gardening basics",
          excerpt: "Soil and seeds",
          extractedText:
            "A long digression about compost. Much later the text mentions flow and, separately, a state of attention worth noting.",
          sourceType: "HTML",
          extractionStatus: "SUCCESS",
          savedAt: new Date("2024-01-01"),
        },
        {
          id: `${userId}-miss`,
          userId,
          title: "Cooking pasta",
          extractedText: "Boil water, add salt.",
          sourceType: "HTML",
          extractionStatus: "SUCCESS",
          savedAt: new Date("2025-01-01"),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.article.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  async function search(q: string): Promise<SearchResponse> {
    const res = await app.inject({
      method: "GET",
      url: `/api/search?q=${encodeURIComponent(q)}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as SearchResponse;
  }

  it("matches multi-word queries whose terms are not adjacent", async () => {
    // The exact case from #155: as one literal substring this matched nothing.
    const body = await search("flow state attention");
    const ids = body.articles.map((a) => a.id);
    expect(ids).toContain(`${userId}-title-hit`);
    expect(ids).toContain(`${userId}-body-hit`);
    expect(ids).not.toContain(`${userId}-miss`);
  });

  it("ranks a title match above a body mention, regardless of savedAt", async () => {
    const body = await search("flow state attention");
    // The title hit is the older article; savedAt ordering would invert this.
    expect(body.articles[0]?.id).toBe(`${userId}-title-hit`);
  });

  it("stems, so a query finds a different inflection", async () => {
    const body = await search("running");
    expect(body.articles.map((a) => a.id)).toContain(`${userId}-title-hit`);
  });

  it("returns a snippet marking the matched terms", async () => {
    const body = await search("compost");
    const snippet = body.snippets?.[`${userId}-body-hit`];
    expect(snippet).toBeTypeOf("string");
    expect(snippet).toContain(SNIPPET_MARK_START);
    // The snippet is context from the body, not the whole document.
    expect(snippet!.length).toBeLessThan(400);
  });

  it("does not emit HTML in snippets, so nothing needs escaping downstream", async () => {
    const body = await search("compost");
    const snippet = body.snippets?.[`${userId}-body-hit`] ?? "";
    expect(snippet).not.toContain("<mark>");
    expect(snippet).not.toContain("<");
  });

  it("still matches an exact tag, which is deliberately outside the tsvector", async () => {
    await prisma.article.update({
      where: { id: `${userId}-miss` },
      data: { tags: ["kitchen"] },
    });
    const body = await search("kitchen");
    expect(body.articles.map((a) => a.id)).toContain(`${userId}-miss`);
  });

  it("returns nothing for a blank query rather than everything", async () => {
    const body = await search("   ");
    expect(body.articles).toHaveLength(0);
    expect(body.highlights).toHaveLength(0);
  });
});
