/**
 * The extension talks to the same API as the web and mobile apps, but does
 * not share their data layer, and deliberately implements only a slice of
 * it. This file is that slice, declared here so an absence reads as a
 * decision rather than an omission:
 *
 * - Types are local structural subsets, not @booklet/shared imports. Same
 *   reason highlight-store.ts gives for not importing canonicalizeUrl: the
 *   extension has no dependency on that package, and adding one means
 *   building it before the extension in a CI job that currently doesn't.
 *   Everything here is a subset of a real shared type, and the fields not
 *   named are ones this extension never reads.
 * - No local/anonymous mode. Every function below is authenticated-only;
 *   there is no IndexedDB fallback the way lib/data/* has on web, and no
 *   POST /api/sync/import path, because there is no local library to
 *   migrate (#172's file-upload phase likewise has nothing to do here).
 * - Highlights are created, never listed, patched or deleted -- so
 *   Highlight.prompt (#157) and the SM-2 fields (#171) are never sent and
 *   never read. Import always colors YELLOW; there is no picker.
 * - No account settings and no account deletion (#174). Both need
 *   confirmation UI this 300px popup does not have, and both belong where
 *   the rest of the account lives.
 */
import { API_URL } from "./config";

interface StoredSession {
  accessToken: string;
  accessTokenExpiresAt: string;
  email: string;
}

/** Exported so the background script can watch this exact key via
 * chrome.storage.onChanged rather than re-declaring the literal. */
export const STORAGE_KEY = "booklet_session";

export async function getSession(): Promise<StoredSession | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const session = result[STORAGE_KEY] as Partial<StoredSession> | undefined;
  if (!session) return null;

  // Shape-checked, not cast. A record missing accessTokenExpiresAt makes the
  // comparison below `NaN <= now`, which is false -- so a half-written or
  // hand-edited storage entry read as a *valid* session. The popup then
  // showed the signed-in view instead of the login form, every request went
  // out as `Bearer undefined`, and there was no way back to logging in short
  // of clearing the extension's storage by hand.
  if (
    typeof session.accessToken !== "string" ||
    !session.accessToken ||
    typeof session.accessTokenExpiresAt !== "string" ||
    typeof session.email !== "string"
  ) {
    await chrome.storage.local.remove(STORAGE_KEY);
    return null;
  }

  const expiresAt = new Date(session.accessTokenExpiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return session as StoredSession;
}

async function setSession(session: StoredSession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
}

async function clearSession(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    return new ApiError(res.status, body.error ?? "unknown_error", body.message ?? res.statusText);
  } catch {
    return new ApiError(res.status, "unknown_error", res.statusText);
  }
}

/**
 * Deliberately simpler than the web app's lib/api/client.ts -- no silent
 * refresh-on-401 loop. If the access token has expired, getSession()
 * already returns null and the popup shows the login form again; there's
 * no long-lived background context here where a silent refresh matters.
 */
async function apiFetch<T>(path: string, options: RequestInit & { auth?: boolean } = {}): Promise<T> {
  const { auth = true, headers, ...rest } = options;
  const finalHeaders = new Headers(headers);
  if (rest.body && typeof rest.body === "string" && !finalHeaders.has("Content-Type")) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (auth) {
    const session = await getSession();
    if (session) finalHeaders.set("Authorization", `Bearer ${session.accessToken}`);
  }

  const res = await fetch(`${API_URL}${path}`, { ...rest, headers: finalHeaders, credentials: "include" });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<void> {
  const body = await apiFetch<{ accessToken: string; accessTokenExpiresAt: string; user: { email: string } }>(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }), auth: false },
  );
  await setSession({ accessToken: body.accessToken, accessTokenExpiresAt: body.accessTokenExpiresAt, email: body.user.email });
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST", auth: false }).catch(() => undefined);
  await clearSession();
}

export interface SaveArticleResult {
  id: string;
  title: string | null;
  extractionStatus: "PENDING" | "SUCCESS" | "FAILED";
  extractionError: string | null;
}

export async function saveArticle(url: string): Promise<SaveArticleResult> {
  return apiFetch<SaveArticleResult>("/api/articles", { method: "POST", body: JSON.stringify({ url }) });
}

/** Find an article already in the library by URL. Matched server-side against
 * both the raw and canonical URL, the same way the save route's duplicate
 * check is -- so this can't miss a row that saving would reject as a 409. */
export async function findArticleByUrl(url: string): Promise<SaveArticleResult | null> {
  const body = await apiFetch<{ articles: SaveArticleResult[] }>(
    `/api/articles?limit=1&url=${encodeURIComponent(url)}`,
  );
  return body.articles[0] ?? null;
}

export interface CreateHighlightInput {
  articleId: string;
  selectedText: string;
  position: { type: "text"; exact: string; prefix: string; suffix: string; start: number; end: number };
  color: string;
}

export async function createHighlight(input: CreateHighlightInput): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/api/highlights", { method: "POST", body: JSON.stringify(input) });
}
