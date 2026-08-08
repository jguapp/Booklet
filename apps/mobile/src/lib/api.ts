import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuthResponse, UserProfile } from "@booklet/shared";
import { API_URL } from "./config";

interface StoredSession {
  accessToken: string;
  accessTokenExpiresAt: string;
}

const STORAGE_KEY = "booklet_session";

/**
 * The token lives in AsyncStorage, which on both platforms is plain
 * app-private storage (an unencrypted SQLite file on Android, a file in the
 * app container on iOS) -- readable by anything running as this app, and by
 * anyone with a rooted/jailbroken device or an unencrypted device backup.
 * That is the same exposure the web app's in-memory-plus-refresh-cookie
 * story avoids, and the honest reason it is acceptable here is that the
 * access token is short-lived and there is no refresh token stored beside
 * it. expo-secure-store (Keychain/Keystore) is the upgrade when mobile
 * grows a real refresh flow; it is a new native dependency, so it is not
 * worth adding for a value that expires on its own.
 */
export async function getSession(): Promise<StoredSession | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    // A read failure is not "signed out" in any meaningful sense, but it is
    // the only safe thing to report: the alternative is throwing out of
    // every apiFetch and out of App's startup session check, which used to
    // leave the app on its loading spinner forever with no way back.
    return null;
  }
  if (!raw) return null;

  let session: unknown;
  try {
    session = JSON.parse(raw);
  } catch {
    // Truncated/corrupt JSON. Dropped rather than left in place: it can
    // never parse, so every future launch would hit this same branch, and
    // nothing else ever rewrites the key until a successful login.
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    return null;
  }

  // Shape-checked rather than cast. A stored object missing
  // accessTokenExpiresAt makes the comparison below `NaN <= now`, which is
  // false -- so a garbage record would read as a *valid* session, every
  // request would go out as `Bearer undefined`, and the app would sit on the
  // library screen 401ing with no way to reach the login form again.
  if (
    typeof session !== "object" ||
    session === null ||
    typeof (session as StoredSession).accessToken !== "string" ||
    typeof (session as StoredSession).accessTokenExpiresAt !== "string"
  ) {
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
    return null;
  }

  const stored = session as StoredSession;
  const expiresAt = new Date(stored.accessTokenExpiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return stored;
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

/**
 * Login is the only auth call this app makes, and that is a scope decision
 * rather than an oversight. Signup, password reset, settings, session
 * management and account deletion (#174, DELETE /api/auth/me) all exist on
 * the API and all have web counterparts in apps/web/src/lib/data/; none has
 * a screen here, and shipping a data function with no caller would just be
 * untested code that looks supported. Account deletion in particular must
 * not be added without its confirmation UI: the route takes a password or a
 * typed-out email depending on UserProfile.hasPassword, and getting that
 * branch wrong on a mobile keyboard deletes a library that cannot come back.
 */
export async function login(email: string, password: string): Promise<UserProfile> {
  const body = await apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    auth: false,
  });
  await setSession({ accessToken: body.accessToken, accessTokenExpiresAt: body.accessTokenExpiresAt });
  return body.user;
}

