/**
 * Single source of truth for which origins get cross-origin access --
 * shared between the global @fastify/cors registration (app.ts) and any
 * route that bypasses Fastify's normal reply pipeline via reply.hijack()
 * (see articles.ts's /file route: streaming a large file through
 * reply.send() was found to hang forever, reproducibly, with
 * @fastify/cors registered -- reply.hijack() sidesteps whatever's actually
 * wrong there, but that also means @fastify/cors's own onSend hook never
 * runs for that response, so it has to set these headers itself instead).
 */
const isDev = process.env.NODE_ENV !== "production";

/**
 * Refuses to let production boot on a WEB_ORIGIN it cannot match.
 *
 * Unset, this file's production branch below can never return true for any
 * browser origin, and nothing anywhere says so: the API starts, logs nothing
 * unusual, passes its health check and answers `curl` (which sends no Origin)
 * perfectly, while the deployed web app is completely broken with only
 * client-side CORS errors in a console nobody is watching. A trailing slash
 * or an http/https mismatch produces exactly the same silence, because the
 * comparison is a string equality against the browser's Origin header, which
 * is always scheme://host[:port] and never has a trailing slash.
 *
 * A boot failure instead, the same treatment JWT_ACCESS_SECRET already gets
 * (lib/auth/tokens.ts): a deploy that cannot serve the web app should not
 * replace one that could. Production only -- dev, test and CI never set this
 * variable and do not need to, since the localhost allowance above covers
 * them, and a guard that fired there would be deleted rather than obeyed.
 *
 * The scheme mismatch itself is undetectable from in here; the exported
 * message names it so the value is at least printed somewhere a human reads
 * when one of the detectable siblings fires.
 */
export function assertUsableWebOrigin(
  value: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv !== "production") return;

  const hint =
    "It must exactly match the browser's Origin header for your deployed web app -- " +
    'scheme://host[:port], no trailing slash, and the same scheme the browser uses (e.g. "https://read.example.com").';

  if (!value) {
    throw new Error(`WEB_ORIGIN is not set, so no browser origin can be allowed and the web app cannot call this API. ${hint}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`WEB_ORIGIN is not an absolute URL (got "${value}"). ${hint}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`WEB_ORIGIN must be an http(s) origin (got "${value}"). ${hint}`);
  }

  if (value !== parsed.origin) {
    throw new Error(`WEB_ORIGIN must be exactly "${parsed.origin}" (got "${value}"). ${hint}`);
  }
}

// At import time, not at first request: this module is imported from app.ts,
// so "imported" is "starting", and the failure it guards against is a deploy
// that looks healthy while serving nothing to a browser.
assertUsableWebOrigin(process.env.WEB_ORIGIN);

export function isAllowedOrigin(origin: string): boolean {
  if (/^(chrome|moz)-extension:\/\//.test(origin)) return true;
  if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  if (!isDev && process.env.WEB_ORIGIN && origin === process.env.WEB_ORIGIN) return true;
  return false;
}
