/** "Developer" settings -- personal access tokens for /api/v1 and webhooks. */

export interface ApiTokenSummary {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreateApiTokenRequest {
  name: string;
  scopes?: ("read" | "write")[];
}

/** Only returned once, at creation -- the server never stores or shows the raw token again. */
export interface CreateApiTokenResponse extends ApiTokenSummary {
  token: string;
}

export interface WebhookEventType {
  value: "article.created" | "highlight.created";
  label: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export interface CreateWebhookRequest {
  url: string;
  events: string[];
}

export interface WebhookDeliverySummary {
  id: string;
  event: string;
  statusCode: number | null;
  success: boolean;
  error: string | null;
  createdAt: string;
}
