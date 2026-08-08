import type { DeleteAccountRequest } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";

/**
 * Authenticated-only, and deliberately with no local-mode counterpart (#174).
 *
 * Every other module in lib/data/* falls back to IndexedDB when there is no
 * account, because the feature still means something offline. "Delete your
 * account" does not: a browser with no account has nothing on the server to
 * delete, and clearing local reading data is a different action with
 * different consequences. Conflating them behind one function is how someone
 * ends up losing their local library to a button they pressed expecting a
 * server-side no-op.
 */
export async function deleteAccount(confirmation: DeleteAccountRequest): Promise<void> {
  await apiFetch("/api/auth/me", { method: "DELETE", body: JSON.stringify(confirmation) });
}
