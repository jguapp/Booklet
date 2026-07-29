import { selectHighlightsToResurface, type ResurfaceCandidate } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";

/** Fetch a user's eligible highlights, hand them to the pure SM-2 selection algorithm, return the full rows it picked. */
export async function getHighlightsToResurface(userId: string, count: number) {
  const rows = await prisma.highlight.findMany({
    // A trashed article's highlights shouldn't keep resurfacing -- trashing
    // is a stronger "I'm done with this" signal than archiving (whose
    // highlights are still eligible on purpose).
    where: { userId, article: { deletedAt: null } },
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
