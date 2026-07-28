import { selectHighlightsToResurface, type ResurfaceCandidate } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";

/** Fetch a user's eligible highlights, hand them to the pure SM-2 selection algorithm, return the full rows it picked. */
export async function getHighlightsToResurface(userId: string, count: number) {
  const rows = await prisma.highlight.findMany({
    where: { userId },
    include: { annotation: true },
  });

  const candidates: ResurfaceCandidate[] = rows.map((row) => ({
    id: row.id,
    nextDueAt: row.nextDueAt?.toISOString() ?? null,
    resurfaceArchivedAt: row.resurfaceArchivedAt?.toISOString() ?? null,
  }));

  const selected = selectHighlightsToResurface(candidates, count);
  const selectedIds = new Set(selected.map((c) => c.id));

  return rows.filter((row) => selectedIds.has(row.id));
}
