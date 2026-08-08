import type { Metadata } from "next";
import { PublicSharePage } from "@/components/highlights/public-share-page";

/**
 * The public shared-highlights page (#158 part 1).
 *
 * Lives at the app root, outside the `(app)` route group, on purpose. That
 * group's layout is the signed-in shell: sidebar, collection tree, command
 * palette, the account's own email in the corner. Rendering a public page
 * inside it would put the owner's identity on screen the moment they opened
 * their own link to check it looked right -- and worse, would leave a
 * stranger's page one layout change away from the same thing. A route group
 * only wraps what is nested under it, so being outside `(app)` is a
 * structural guarantee rather than a rule someone has to remember.
 *
 * `/s/:slug` rather than `/share/:slug`: these get pasted into messages, and
 * the slug is already 22 characters.
 */
export const metadata: Metadata = {
  title: "Shared highlights",
  // The root layout already sets noindex sitewide. Restated here because the
  // reasoning is different and outlives that one: an unlisted URL that a
  // crawler indexes is no longer unlisted, and the person who shared it with
  // one friend never agreed to a search result.
  robots: { index: false, follow: false },
};

export default async function SharedHighlightsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicSharePage slug={slug} />;
}
