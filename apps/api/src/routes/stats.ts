import type { FastifyInstance } from "fastify";
import type { ReadingActivityResponse } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../lib/auth/context.js";
import { utcMidnight } from "../lib/dates.js";

// A full year, GitHub-contributions-style -- the stats page's own heatmap
// used to only show 12 weeks; this endpoint existing at all is specifically
// to back a real "days read" signal (see ReadingActivityDay's schema
// comment), so it may as well match the thing it's visually modeled after.
const WEEKS = 53;

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stats/reading-activity", { preHandler: requireAuth }, async (request, reply) => {
    const since = utcMidnight(new Date());
    since.setUTCDate(since.getUTCDate() - WEEKS * 7);

    const rows = await prisma.readingActivityDay.findMany({
      where: { userId: request.userId!, date: { gte: since } },
      orderBy: { date: "asc" },
    });

    const body: ReadingActivityResponse = {
      days: rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), seconds: r.seconds })),
    };
    return reply.send(body);
  });
}
