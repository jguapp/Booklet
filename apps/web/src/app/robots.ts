import type { MetadataRoute } from "next";

/**
 * Matches the sitewide `robots: { index: false }` in layout.tsx: this is
 * proprietary, not-yet-launched software, so crawlers are told to stay out
 * at the HTTP level too, not just via the meta tag they'd only see after
 * fetching the page.
 *
 * At launch, this flips together with layout.tsx's metadata: allow "/",
 * keep the app surface (everything behind auth) and the share pages
 * disallowed -- share links are for the people they're sent to, not for
 * search results -- and point `sitemap` at sitemap.ts, which already lists
 * only the public marketing/legal pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
