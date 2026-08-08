/**
 * Sharing (#158). Sits in lib/data/*.ts alongside articles.ts and
 * highlights.ts, but breaks their local-vs-synced pattern in two different
 * ways, both deliberate.
 *
 * **Owner-side sharing is account-only, like developer.ts.** A share is a URL
 * some *other* person opens; there is no way to serve one from a library that
 * only exists in this browser's IndexedDB. So none of the functions below
 * branch on `authenticated` -- local mode has no degraded equivalent to fall
 * back to, and inventing one (a fake link that 404s for the recipient) would
 * be worse than the UI saying sharing needs an account. Callers in local mode
 * simply don't render the share controls.
 *
 * **Reading a shared page, and the onboarding seeds, are the opposite:** they
 * are public endpoints and must work with no session whatsoever, including
 * for a visitor who has never heard of Booklet. Those two use a bare fetch
 * rather than apiFetch, see publicFetch below.
 */
import type {
  ContributionSettings,
  CreateShareRequest,
  OnboardingSeedsResponse,
  PublicShareResponse,
  Share,
  UpdateContributionSettingsRequest,
} from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";

// Same default as lib/api/client.ts. Duplicated rather than exported from
// there because publicFetch deliberately shares none of that module's
// behavior (see below) and importing one const would suggest otherwise.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Fetch for the unauthenticated endpoints, with `credentials: "omit"` and no
 * Authorization header.
 *
 * apiFetch would send both the access token and the refresh cookie, and on a
 * 401 would try a silent refresh. None of that is wanted here: a public page
 * must render identically for its owner and for a stranger, and the fastest
 * way to ship a leak is to build a page that quietly shows more to whoever
 * happens to be signed in while you're testing it. Omitting credentials makes
 * that mistake impossible to make locally without noticing.
 */
async function publicFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "omit" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json() as Promise<T>;
}

export function loadPublicShare(slug: string): Promise<PublicShareResponse> {
  return publicFetch<PublicShareResponse>(`/api/public/shares/${encodeURIComponent(slug)}`);
}

export function loadOnboardingSeeds(): Promise<OnboardingSeedsResponse> {
  return publicFetch<OnboardingSeedsResponse>("/api/public/seeds");
}

export function loadShares(): Promise<Share[]> {
  return apiFetch<Share[]>("/api/shares");
}

export function createShare(input: CreateShareRequest): Promise<Share> {
  return apiFetch<Share>("/api/shares", { method: "POST", body: JSON.stringify(input) });
}

/** Deletes the share, which is what makes the old URL dead rather than
 * merely hidden -- see the Share model's schema comment. */
export function revokeShare(id: string): Promise<void> {
  return apiFetch(`/api/shares/${id}`, { method: "DELETE" });
}

export function loadContributionSettings(): Promise<ContributionSettings> {
  return apiFetch<ContributionSettings>("/api/shares/contribution");
}

export function setContributionSetting(contributesToPublicHighlights: boolean): Promise<ContributionSettings> {
  const body: UpdateContributionSettingsRequest = { contributesToPublicHighlights };
  return apiFetch<ContributionSettings>("/api/shares/contribution", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** The public page's own URL, which is what actually gets copied and sent.
 * Built from window.location so a self-hosted deployment hands out its own
 * origin rather than one baked in at build time. */
export function shareUrl(slug: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/s/${slug}`;
}
