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
import { captureException, initErrorMonitoring } from "./lib/error-monitoring.js";

/**
 * Builds a fully-configured Fastify instance without binding a port -- the
 * split from index.ts exists so tests can `.inject()` requests directly
 * against a real app instance (routes, plugins, error handler, all of it)
 * instead of needing a live server listening on a real socket.
 */
export async function buildApp(): Promise<FastifyInstance> {
  initErrorMonitoring();

  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.setErrorHandler((err: FastifyError, request, reply) => {
    captureException(err);
    app.log.error(err);
    const statusCode = err.statusCode ?? 500;
    reply.code(statusCode).send({
      error: statusCode === 500 ? "internal_error" : (err.code ?? "error"),
      message: statusCode === 500 ? "Something went wrong." : err.message,
    });
  });

  const isDev = process.env.NODE_ENV !== "production";

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
  // relies on.
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // same-origin / non-browser requests (e.g. curl)
      if (/^(chrome|moz)-extension:\/\//.test(origin)) return callback(null, true);
      if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return callback(null, true);
      if (!isDev && process.env.WEB_ORIGIN && origin === process.env.WEB_ORIGIN) return callback(null, true);
      callback(null, false);
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

  return app;
}
