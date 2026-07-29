/**
 * User-chosen sidebar nav order (app layout.tsx's drag-and-drop reorder) --
 * device-local, an array of `href`s. Anything not present (a nav item added
 * since the user last reordered, e.g. Stats only appearing once its own
 * toggle is on) is appended at the end in its default relative order --
 * see applyNavOrder -- rather than being lost or crashing the sort.
 */
const KEY = "booklet-nav-order";

export function loadNavOrder(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((h) => typeof h === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export function saveNavOrder(order: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    // best-effort only
  }
}

/** Sorts `items` (by their `href`) according to a saved order, appending
 * anything not mentioned in it at the end, in their original relative order. */
export function applyNavOrder<T extends { href: string }>(items: T[], order: string[]): T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((href, i) => [href, i]));
  return [...items].sort((a, b) => {
    const ra = rank.get(a.href);
    const rb = rank.get(b.href);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return 0; // neither ordered -- keep original relative order (stable sort)
  });
}
