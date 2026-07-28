import * as Sentry from "@sentry/browser";

/**
 * No-op without NEXT_PUBLIC_SENTRY_DSN -- error monitoring is opt-in
 * infrastructure, not something that should require an account to run the
 * app locally. Set it in production to actually capture anything.
 */
let initialized = false;

export function initErrorMonitoring(): void {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
  initialized = true;
}

export function captureException(err: unknown): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  Sentry.captureException(err);
}
