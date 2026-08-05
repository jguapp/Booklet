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

export function isAllowedOrigin(origin: string): boolean {
  if (/^(chrome|moz)-extension:\/\//.test(origin)) return true;
  if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return true;
  if (!isDev && process.env.WEB_ORIGIN && origin === process.env.WEB_ORIGIN) return true;
  return false;
}
