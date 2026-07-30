import type {
  ApiTokenSummary,
  CreateApiTokenRequest,
  CreateApiTokenResponse,
  CreateWebhookRequest,
  Webhook,
  WebhookDeliverySummary,
} from "@booklet/shared";
import { apiFetch } from "@/lib/api/client";

/**
 * Developer settings (personal access tokens for /api/v1, webhooks) are
 * authenticated-account-only -- unlike everything else in lib/data/*.ts,
 * there's no local/anonymous-mode equivalent, since a token or webhook is
 * inherently about letting some *other* system reach your synced account
 * from outside the browser. Nothing here branches on `authenticated`.
 */

export function createApiToken(input: CreateApiTokenRequest): Promise<CreateApiTokenResponse> {
  return apiFetch<CreateApiTokenResponse>("/api/tokens", { method: "POST", body: JSON.stringify(input) });
}

export function loadApiTokens(): Promise<ApiTokenSummary[]> {
  return apiFetch<ApiTokenSummary[]>("/api/tokens");
}

export function revokeApiToken(id: string): Promise<void> {
  return apiFetch(`/api/tokens/${id}`, { method: "DELETE" });
}

export function createWebhook(input: CreateWebhookRequest): Promise<Webhook> {
  return apiFetch<Webhook>("/api/webhooks", { method: "POST", body: JSON.stringify(input) });
}

export function loadWebhooks(): Promise<Webhook[]> {
  return apiFetch<Webhook[]>("/api/webhooks");
}

export function deleteWebhook(id: string): Promise<void> {
  return apiFetch(`/api/webhooks/${id}`, { method: "DELETE" });
}

export function loadWebhookDeliveries(id: string): Promise<WebhookDeliverySummary[]> {
  return apiFetch<WebhookDeliverySummary[]>(`/api/webhooks/${id}/deliveries`);
}
