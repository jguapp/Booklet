import type { SessionInfo } from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";

// Authenticated-only -- there's no local-mode equivalent of "devices signed in".
export async function loadSessions(): Promise<SessionInfo[]> {
  return apiFetch<SessionInfo[]>("/api/auth/sessions");
}

export async function revokeSession(id: string): Promise<void> {
  await apiFetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
}

export async function revokeOtherSessions(): Promise<{ revokedCount: number }> {
  return apiFetch<{ revokedCount: number }>("/api/auth/sessions/revoke-others", { method: "POST" });
}
