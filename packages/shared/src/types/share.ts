/**
 * Public sharing (#158 part 1) and the onboarding seeds built on top of it
 * (#158 part 2).
 *
 * The two halves live together because the second is defined by the first:
 * a passage only ever reaches PublicHighlightStat if its owner published the
 * page it sits on *and* separately opted into contributing. Splitting them
 * into two modules would have hidden that dependency behind an import.
 */

export type ShareTargetType = "article" | "collection";

/**
 * A share as its *owner* sees it. Carries the slug (they need it to copy the
 * link) and viewCount (theirs to know) -- neither of which appears in
 * PublicShareResponse below.
 */
export interface Share {
  id: string;
  slug: string;
  targetType: ShareTargetType;
  /** Exactly one of these is set, matching the Share model's own constraint. */
  articleId: string | null;
  collectionId: string | null;
  viewCount: number;
  createdAt: string;
}

/** Exactly one field must be set -- the route rejects both/neither. */
export interface CreateShareRequest {
  articleId?: string;
  collectionId?: string;
}

/**
 * One published highlight. No id: a viewer with the link has no use for the
 * server-side highlight id, and handing out real ids from an unauthenticated
 * route is free information about the owner's library for zero benefit.
 */
export interface PublicSharedHighlight {
  text: string;
  /** The owner's own note, published alongside the passage it belongs to. */
  note: string | null;
  color: string;
}

/**
 * Attribution for one published article. Deliberately four fields and no
 * more: enough to credit the original and link back to it, and nothing that
 * describes the Booklet account that saved it. Notably absent are the
 * extracted body text and the publisher's own excerpt/cover image -- see
 * PublicShareResponse.
 */
export interface PublicSharedSource {
  title: string;
  author: string | null;
  siteName: string | null;
  /** Null for a PDF/EPUB upload, which has no source URL to point at. */
  url: string | null;
}

export interface PublicSharedArticle {
  source: PublicSharedSource;
  highlights: PublicSharedHighlight[];
}

/**
 * What GET /api/public/shares/:slug returns -- the entire public surface of
 * a shared page, and an allowlist by construction rather than by filtering.
 *
 * Two absences are load-bearing:
 *
 * - Nothing identifies the owner. No email, no account name, no user id, no
 *   avatar. There is no per-share display name column to opt into either, so
 *   there is nothing here that *could* carry an identity even by accident.
 * - No article body. Sharing highlights of a copyrighted article means
 *   publishing excerpts, so a shared page carries the reader's own selected
 *   passages plus attribution and a link to the original -- never the
 *   extracted full text, and never the publisher's excerpt or cover image,
 *   which are the publisher's content rather than the reader's selection.
 */
export interface PublicShareResponse {
  targetType: ShareTargetType;
  /**
   * The article's title, or the collection's name. A collection name is
   * user-authored text the owner chose to publish by sharing it -- unlike
   * their account name, which they never chose to attach to this page.
   */
  title: string;
  sharedAt: string;
  articles: PublicSharedArticle[];
  /** Across every article on the page -- of the *published* highlights only,
   * so it can't be used to infer how much else is in the owner's library. */
  highlightCount: number;
}

/**
 * Where a seed passage came from. The distinction is shown to the reader,
 * not just tracked internally: "3 Booklet readers highlighted this" and
 * "from a public-domain edition" are different claims and shouldn't look
 * alike.
 */
export type SeedOrigin = "community" | "public-domain";

export interface SeedHighlight {
  text: string;
  sourceTitle: string;
  sourceAuthor: string | null;
  sourceUrl: string | null;
  /** Public-domain seeds only -- the translation is part of the attribution,
   * and it is also what makes some of these public domain at all (a modern
   * translation of an ancient text is its own copyrighted work). */
  translator?: string | null;
  origin: SeedOrigin;
  /**
   * Community seeds only: how many distinct accounts highlighted the
   * passage. Always at least the aggregation threshold -- see
   * MIN_DISTINCT_USERS in aggregation-service.ts. Never a list, never an
   * identity, just a count.
   */
  highlightedBy?: number;
}

export interface SeedCollection {
  id: string;
  title: string;
  description: string;
  highlights: SeedHighlight[];
}

export interface OnboardingSeedsResponse {
  collections: SeedCollection[];
}

/**
 * The aggregation opt-in, separate from sharing itself: publishing one page
 * for one friend is not consent to have your highlights counted across the
 * whole user base.
 */
export interface ContributionSettings {
  contributesToPublicHighlights: boolean;
}

export type UpdateContributionSettingsRequest = ContributionSettings;
