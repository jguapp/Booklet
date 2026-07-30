"use client";

import { useEffect, useState } from "react";
import type { ApiTokenSummary, Webhook, WebhookDeliverySummary } from "@booklet/shared";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth/auth-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { formatRelativeDate } from "@/lib/format";
import {
  createApiToken,
  createWebhook,
  deleteWebhook,
  loadApiTokens,
  loadWebhookDeliveries,
  loadWebhooks,
  revokeApiToken,
} from "@/lib/data/developer";
import { cn } from "@/lib/cn";

const EVENT_OPTIONS = [
  { value: "article.created", label: "Article saved" },
  { value: "highlight.created", label: "Highlight created" },
];

function TokenSection() {
  const { toast } = useToast();
  const [tokens, setTokens] = useState<ApiTokenSummary[] | null>(null);
  const [name, setName] = useState("");
  const [writeScope, setWriteScope] = useState(true);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  const refresh = () => loadApiTokens().then(setTokens);
  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const scopes: ("read" | "write")[] = writeScope ? ["read", "write"] : ["read"];
      const result = await createApiToken({ name: trimmed, scopes });
      setJustCreated(result.token);
      setName("");
      refresh();
    } catch {
      toast("Couldn't create that token.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    await revokeApiToken(id);
    refresh();
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="font-serif text-base font-semibold text-ink">Personal access tokens</h3>
        <p className="mt-1 font-sans text-sm text-ink-muted">
          For scripts and automations (Zapier, a cron job, your own tooling) that need to reach{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">/api/v1</code> from outside the browser.
        </p>
      </div>

      {justCreated && (
        <div className="rounded-md border border-accent/30 bg-accent/10 px-4 py-3">
          <p className="font-sans text-xs font-medium text-ink">
            Copy this now -- it won&apos;t be shown again.
          </p>
          <code
            data-testid="generated-token"
            className="mt-2 block overflow-x-auto rounded-sm bg-surface px-3 py-2 font-mono text-xs text-ink"
          >
            {justCreated}
          </code>
          <button
            type="button"
            onClick={() => setJustCreated(null)}
            className="mt-2 font-sans text-xs font-medium text-accent"
          >
            Done
          </button>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex items-center gap-2">
        <Input
          type="text"
          placeholder="Token name, e.g. Zapier"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-[240px]"
        />
        <label className="flex items-center gap-1.5 font-sans text-sm text-ink-muted">
          <input type="checkbox" checked={writeScope} onChange={(e) => setWriteScope(e.target.checked)} />
          Allow write access
        </label>
        <Button type="submit" variant="secondary" disabled={creating}>
          {creating ? "Generating…" : "Generate token"}
        </Button>
      </form>

      {tokens && tokens.length > 0 && (
        <div className="flex flex-col gap-2">
          {tokens.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-3 rounded-sm border border-border px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate font-sans text-sm text-ink">
                  {t.name}
                  {!t.scopes.includes("write") && (
                    <span className="ml-2 rounded-full bg-surface-2 px-2 py-0.5 font-sans text-[10px] uppercase tracking-wide text-ink-faint">
                      Read only
                    </span>
                  )}
                </p>
                <p className="font-sans text-xs text-ink-faint">
                  {t.lastUsedAt ? `Last used ${formatRelativeDate(t.lastUsedAt)}` : "Never used"} · created{" "}
                  {formatRelativeDate(t.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRevoke(t.id)}
                className="shrink-0 font-sans text-xs font-medium text-ink-muted hover:text-red-500"
              >
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DeliveryHistory({ webhookId }: { webhookId: string }) {
  const [deliveries, setDeliveries] = useState<WebhookDeliverySummary[] | null>(null);

  useEffect(() => {
    loadWebhookDeliveries(webhookId).then(setDeliveries);
  }, [webhookId]);

  if (!deliveries) return null;
  if (deliveries.length === 0) {
    return <p className="mt-2 font-sans text-xs text-ink-faint">No deliveries yet.</p>;
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      {deliveries.map((d) => (
        <div key={d.id} className="flex items-center gap-2 font-sans text-xs">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", d.success ? "bg-accent" : "bg-red-500")} />
          <span className="text-ink-muted">{d.event}</span>
          <span className="text-ink-faint">{d.statusCode ?? d.error ?? "no response"}</span>
          <span className="ml-auto shrink-0 text-ink-faint">{formatRelativeDate(d.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

function WebhookSection() {
  const { toast } = useToast();
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = () => loadWebhooks().then(setWebhooks);
  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || events.length === 0) return;
    setCreating(true);
    try {
      await createWebhook({ url: trimmed, events });
      setUrl("");
      setEvents([]);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't create that webhook.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteWebhook(id);
    refresh();
  }

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <div>
        <h3 className="font-serif text-base font-semibold text-ink">Webhooks</h3>
        <p className="mt-1 font-sans text-sm text-ink-muted">
          Get notified the moment something happens -- each delivery is signed (
          <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">X-Booklet-Signature</code>, HMAC-SHA256) so you
          can verify it actually came from Booklet.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-2">
        <Input
          type="url"
          placeholder="https://your-endpoint.example.com/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          {EVENT_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 font-sans text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={events.includes(opt.value)}
                onChange={(e) =>
                  setEvents((prev) => (e.target.checked ? [...prev, opt.value] : prev.filter((v) => v !== opt.value)))
                }
              />
              {opt.label}
            </label>
          ))}
        </div>
        <div>
          <Button type="submit" variant="secondary" disabled={creating}>
            {creating ? "Adding…" : "Add webhook"}
          </Button>
        </div>
      </form>

      {webhooks && webhooks.length > 0 && (
        <div className="flex flex-col gap-2">
          {webhooks.map((w) => (
            <div key={w.id} className="rounded-sm border border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-sans text-sm text-ink">{w.url}</p>
                  <p className="font-sans text-xs text-ink-faint">{w.events.join(", ")}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId((id) => (id === w.id ? null : w.id))}
                    className="font-sans text-xs font-medium text-accent"
                  >
                    {expandedId === w.id ? "Hide" : "Deliveries"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(w.id)}
                    className="font-sans text-xs font-medium text-ink-muted hover:text-red-500"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {expandedId === w.id && <DeliveryHistory webhookId={w.id} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DeveloperPage() {
  const { status } = useAuth();

  if (status === "loading") return null;

  if (status !== "authenticated") {
    return (
      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold text-ink">Developer</h2>
        <p className="mb-4 font-sans text-sm text-ink-muted">
          Personal access tokens and webhooks sync your account across systems, so they need an account to attach
          to -- sign in or create one to use them.
        </p>
        <ButtonLink href="/signup" variant="secondary">
          Create an account
        </ButtonLink>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-6 font-serif text-lg font-semibold text-ink">Developer</h2>
      <div className="flex flex-col gap-10">
        <TokenSection />
        <WebhookSection />
      </div>
    </div>
  );
}
