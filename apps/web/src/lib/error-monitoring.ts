/**
 * No-op without NEXT_PUBLIC_SENTRY_DSN -- error monitoring is opt-in
 * infrastructure, not something that should require an account to run the
 * app locally. Set it in production to actually capture anything.
 *
 * The SDK is imported dynamically, for the same reason lib/rum.ts imports
 * Datadog dynamically and says so: a static import puts it in the bundle
 * every page loads, configured or not. Measured on this app's own production
 * build, @sentry/browser was an 81KB chunk pulled into the shared entry of
 * every route -- including /login and /signup, which are the first thing a
 * new reader downloads and the least likely to need it. Now the fetch only
 * happens on a deployment that has actually set a DSN, and only once
 * something is being reported.
 */
let initialized = false;
let sdk: Promise<typeof import("@sentry/browser")> | null = null;

/** One shared import promise, so a burst of errors doesn't start several. */
function loadSdk(): Promise<typeof import("@sentry/browser")> {
  sdk ??= import("@sentry/browser");
  return sdk;
}

export async function initErrorMonitoring(): Promise<void> {
  if (initialized) return;
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  // Set before the await, not after: two callers racing here would otherwise
  // both get past the guard and init the SDK twice.
  initialized = true;

  const Sentry = await loadSdk();
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}

export function captureException(err: unknown): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  // Awaits init rather than assuming it: the app-level error boundaries call
  // this, and global-error.tsx replaces the root layout -- so the component
  // that normally runs initErrorMonitoring may never have mounted. Without
  // this, a report from that path went to an SDK with no client attached and
  // was dropped, which is the one crash you least want to lose.
  void initErrorMonitoring()
    .then(() => loadSdk())
    .then((Sentry) => Sentry.captureException(err))
    .catch(() => undefined);
}
