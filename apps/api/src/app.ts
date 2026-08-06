import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import type { HealthResponse } from "@booklet/shared";
import { setupAuthContext } from "./lib/auth/context.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerExtractRoute } from "./routes/extract.js";
import { registerArticleRoutes } from "./routes/articles.js";
import { registerHighlightRoutes } from "./routes/highlights.js";
import { registerDigestRoutes } from "./routes/digests.js";
import { registerSyncRoutes } from "./routes/sync.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerSearchRoute } from "./routes/search.js";
import { registerFeedRoutes } from "./routes/feeds.js";
import { registerApiTokenRoutes } from "./routes/api-tokens.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerV1Routes } from "./routes/v1.js";
import { registerTtsRoute } from "./routes/tts.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { captureException, initErrorMonitoring } from "./lib/error-monitoring.js";
import { isAllowedOrigin } from "./lib/cors.js";

/**
 * Builds a fully-configured Fastify instance without binding a port -- the
 * split from index.ts exists so tests can `.inject()` requests directly
 * against a real app instance (routes, plugins, error handler, all of it)
 * instead of needing a live server listening on a real socket.
 */
export async function buildApp(): Promise<FastifyInstance> {
  initErrorMonitoring();

  // trustProxy is opt-in via env, not on by default, and that distinction
  // matters in both directions.
  //
  // Off (the default) behind a reverse proxy -- which is how this actually
  // deploys on Fly/Railway/Render/nginx/Cloudflare -- every request's
  // `request.ip` is the *proxy's* address, not the client's. @fastify/rate-limit
  // keys on `request.ip` by default (its defaultKeyGenerator is literally
  // `req => req.ip`), so every user in the world would share a single bucket
  // and the TTS limit below would lock everyone out within a minute of launch.
  //
  // On when there *isn't* a trusted proxy in front is the opposite failure:
  // X-Forwarded-For is client-controlled, so anyone could spoof a fresh IP per
  // request and bypass rate limiting entirely. Hence env-gated rather than
  // either hardcoded value -- see DEPLOYMENT.md.
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: process.env.TRUST_PROXY === "true",
  });

  app.setErrorHandler((err: FastifyError, request, reply) => {
    captureException(err);
    app.log.error(err);
    const statusCode = err.statusCode ?? 500;
    reply.code(statusCode).send({
      error: statusCode === 500 ? "internal_error" : (err.code ?? "error"),
      message: statusCode === 500 ? "Something went wrong." : err.message,
    });
  });

  // Next.js picks the next free port (3001, 3002, ...) when 3000 is taken, so a
  // fixed origin string is brittle in dev. Any localhost port is fine locally;
  // production still pins to the one configured WEB_ORIGIN. `credentials: true`
  // is required so the refresh-token cookie rides along with fetch requests.
  // chrome-extension:// (Chrome/Edge/other Chromium browsers) and
  // moz-extension:// (Firefox) origins are always allowed -- the browser
  // extension is a real, separate client (see apps/extension) that runs on
  // both, and neither origin scheme is an http(s) URL CORS can pin the way
  // WEB_ORIGIN pins the web app; the actual security boundary is the auth
  // token/session, same as the localhost-any-port allowance below already
  // relies on. isAllowedOrigin lives in lib/cors.ts, not inline here, since
  // articles.ts's /file route needs the exact same logic (see its own
  // comment for why).
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // same-origin / non-browser requests (e.g. curl)
      callback(null, isAllowedOrigin(origin));
    },
    // Default (this @fastify/cors version) preflight-allows only GET/HEAD/
    // POST -- silently breaking every authenticated PATCH/PUT/DELETE
    // request from a real browser (rename/delete a collection, revoke a
    // token, anything not a plain create). Every previous e2e test in this
    // suite ran in local/anonymous mode, which serves those same actions
    // out of IndexedDB and never touches the network, so a real signed-in
    // session hitting this was previously untested -- caught building the
    // personal-access-token/webhook feature's first authenticated-mode e2e
    // coverage, not something new this change introduces.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
    // Without this, no Access-Control-Max-Age header is sent and browsers
    // fall back to a very short default (~5s in Chrome) -- meaning a
    // preflight OPTIONS round trip in front of essentially every request.
    // That lands squarely on the TTS critical path: /api/tts is a POST with
    // Content-Type: application/json and credentials: "include" (see
    // apps/web/src/lib/api/client.ts), i.e. never a "simple" request, so
    // read-aloud pays an extra RTT before the first chunk's generation can
    // even start, and again for every chunk after the short default lapses.
    // 24h is the largest value Chrome honors (Firefox caps at 24h too).
    maxAge: 86400,
  });

  await app.register(cookie);

  // In-memory store -- fine for a single instance. A horizontally-scaled
  // production deployment needs a shared store (e.g. Redis via
  // @fastify/rate-limit's `redis` option) so limits are enforced across
  // instances instead of separately per-process.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
  });

  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 }, // 100MB, matches the web upload UI's stated limit
  });

  await setupAuthContext(app);

  app.get("/api/health", async (): Promise<HealthResponse> => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  await registerAuthRoutes(app);
  await registerExtractRoute(app);
  await registerArticleRoutes(app);
  await registerHighlightRoutes(app);
  await registerDigestRoutes(app);
  await registerSyncRoutes(app);
  await registerCollectionRoutes(app);
  await registerSearchRoute(app);
  await registerFeedRoutes(app);
  await registerApiTokenRoutes(app);
  await registerWebhookRoutes(app);
  await registerV1Routes(app);
  await registerTtsRoute(app);
  await registerStatsRoutes(app);

  return app;
}
