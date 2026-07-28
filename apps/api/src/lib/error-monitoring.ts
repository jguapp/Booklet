import * as Sentry from "@sentry/node";

/**
 * No-op without SENTRY_DSN -- error monitoring is opt-in infrastructure,
 * not something that should require an account to run the app locally or
 * in CI. Set SENTRY_DSN in production to actually capture anything.
 */
export function initErrorMonitoring(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}

export function captureException(err: unknown): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(err);
}
