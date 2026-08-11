import type { MetadataRoute } from "next";

/**
 * Only the public, static pages -- the app surface is auth-gated and the
 * share pages are deliberately unenumerable (capability slugs), so neither
 * belongs in a sitemap. Inert until launch (robots.ts currently disallows
 * everything and doesn't reference this file); wired now so going public
 * is a two-line robots/layout change, not a scavenger hunt.
 *
 * NEXT_PUBLIC_SITE_URL is the deployed origin; the localhost fallback keeps
 * the route harmless in dev.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/login", "/signup", "/privacy", "/terms"].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.5,
  }));
}
