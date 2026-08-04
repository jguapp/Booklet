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
  const session = result[STORAGE_KEY] as StoredSession | undefined;
  if (!session) return null;
  if (new Date(session.accessTokenExpiresAt).getTime() <= Date.now()) return null;
  return session;
}

export async function setSession(session: StoredSession): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: session });
}

export async function clearSession(): Promise<void> {
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
export async function apiFetch<T>(path: string, options: RequestInit & { auth?: boolean } = {}): Promise<T> {
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
