/**
 * Plain (non-React) access-token bookkeeping. Kept separate from
 * auth-provider.tsx so lib/api/client.ts can import it without a circular
 * dependency (client -> session -> [fetch directly, not client]).
 *
 * The access token lives in memory + a localStorage mirror (so a page
 * reload doesn't force a network round trip before the UI knows whether
 * someone's signed in); the refresh token is an httpOnly cookie the browser
 * manages on its own -- this module never touches it directly.
 */
const STORAGE_KEY = "booklet-access-token";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface StoredToken {
  token: string;
  expiresAt: number; // epoch ms
}

let current: StoredToken | null = null;
let hydrated = false;

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as StoredToken;
    if (typeof parsed.token === "string" && typeof parsed.expiresAt === "number") {
      current = parsed;
    }
  } catch {
    // ignore malformed/unavailable storage
  }
}

export function getAccessToken(): string | null {
  hydrate();
  if (!current) return null;
  if (current.expiresAt <= Date.now()) return null;
  return current.token;
}

export function setAccessToken(token: string, expiresAtIso: string): void {
  current = { token, expiresAt: new Date(expiresAtIso).getTime() };
  hydrated = true;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // best-effort only -- the in-memory copy still works for this tab
  }
}

export function clearAccessToken(): void {
  current = null;
  hydrated = true;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Attempts to mint a new access token from the httpOnly refresh cookie. */
export async function silentRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { accessToken: string; accessTokenExpiresAt: string };
    setAccessToken(body.accessToken, body.accessTokenExpiresAt);
    return true;
  } catch {
    return false;
  }
}
