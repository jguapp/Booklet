/**
 * Deliberately hand-rolled rather than a dependency -- this app has stayed
 * dependency-light throughout, and a command palette's matching needs are
 * simple enough not to justify one. Returns a score (higher = better
 * match) or null for no match at all; exact/prefix/contains match beat a
 * plain in-order-subsequence match, which is the weakest signal but still
 * useful for "types the first letters of each word" muscle memory.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = target.toLowerCase();

  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;

  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length ? 20 : null;
}
