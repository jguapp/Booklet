import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuthResponse, UserProfile } from "@booklet/shared";
import { API_URL } from "./config";

interface StoredSession {
  accessToken: string;
  accessTokenExpiresAt: string;
}

const STORAGE_KEY = "booklet_session";

export async function getSession(): Promise<StoredSession | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const session: StoredSession = JSON.parse(raw);
  if (new Date(session.accessTokenExpiresAt).getTime() <= Date.now()) return null;
  return session;
}

async function setSession(session: StoredSession): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
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
 * No refresh-token flow here (mobile's httpOnly-cookie story is messier than
 * a browser's) -- the access token is just kept around until it expires, at
 * which point the app drops back to the login screen. Real refresh-token
 * support for mobile is a reasonable next step, not implemented here.
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

  const res = await fetch(`${API_URL}${path}`, { ...rest, headers: finalHeaders });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string): Promise<UserProfile> {
  const body = await apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    auth: false,
  });
  await setSession({ accessToken: body.accessToken, accessTokenExpiresAt: body.accessTokenExpiresAt });
  return body.user;
}

