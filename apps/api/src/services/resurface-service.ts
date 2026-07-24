import { selectHighlightsToResurface, type ResurfaceCandidate } from "@booklet/shared";
import { prisma } from "../lib/prisma.js";

/**
 * Not yet exercised against a live database (none is connected in this repo
 * yet) -- the selection logic itself is verified in isolation via
 * packages/shared/scripts/resurface-demo.ts. This is the thin glue that will
 * make it real once Auth/a live Postgres exist: fetch a user's eligible
 * highlights, hand them to the pure algorithm, return the full rows for
 * whatever it picked.
 */
export async function getHighlightsToResurface(userId: string, count: number) {
  const rows = await prisma.highlight.findMany({
    where: { userId },
    include: { annotation: true },
  });

  const candidates: ResurfaceCandidate[] = rows.map((row) => ({
    id: row.id,
    lastSurfacedAt: row.lastSurfacedAt?.toISOString() ?? null,
    hasAnnotation: row.annotation !== null,
    lastFeedback: row.lastFeedback,
    resurfaceArchivedAt: row.resurfaceArchivedAt?.toISOString() ?? null,
  }));

  const selected = selectHighlightsToResurface(candidates, count);
  const selectedIds = new Set(selected.map((c) => c.id));

  return rows.filter((row) => selectedIds.has(row.id));
}
