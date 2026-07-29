/**
 * Thin fetch wrapper for the real Booklet API. Handles attaching the access
 * token, and transparently retrying once via a silent refresh on a 401 --
 * callers just get a rejected promise if that also fails.
 */
import { clearAccessToken, getAccessToken, silentRefresh } from "@/lib/auth/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions extends RequestInit {
  auth?: boolean; // attach Authorization header (default true)
  skipRetry?: boolean; // internal -- prevents infinite refresh loops
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    return new ApiError(res.status, body.error ?? "unknown_error", body.message ?? res.statusText);
  } catch {
    return new ApiError(res.status, "unknown_error", res.statusText);
  }
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { auth = true, skipRetry = false, headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  // FormData needs the browser to set its own multipart boundary -- an
  // explicit Content-Type here would stop it from doing that.
  if (rest.body && typeof rest.body === "string" && !finalHeaders.has("Content-Type")) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = getAccessToken();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    credentials: "include",
  });

  if (res.status === 401 && auth && !skipRetry) {
    const refreshed = await silentRefresh();
    if (refreshed) {
      return apiFetch<T>(path, { ...options, skipRetry: true });
    }
    clearAccessToken();
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Same auth/retry contract as apiFetch, for endpoints that return raw bytes
 * (GET /api/articles/:id/file) rather than JSON -- apiFetch always calls
 * res.json(), which would throw on a PDF/EPUB response body.
 */
export async function apiFetchBlob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const { auth = true, skipRetry = false, headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  if (auth) {
    const token = getAccessToken();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    credentials: "include",
  });

  if (res.status === 401 && auth && !skipRetry) {
    const refreshed = await silentRefresh();
    if (refreshed) {
      return apiFetchBlob(path, { ...options, skipRetry: true });
    }
    clearAccessToken();
  }

  if (!res.ok) throw await parseError(res);
  return res.blob();
}
