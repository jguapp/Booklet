import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from "fastify";
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
import { registerShareRoutes } from "./routes/shares.js";
import { registerPodcastRoutes } from "./routes/podcast.js";
import { captureException, initErrorMonitoring } from "./lib/error-monitoring.js";
import { isAllowedOrigin } from "./lib/cors.js";
import { ttsPoolStatus } from "./services/tts-pool.js";
import { prisma } from "./lib/prisma.js";

/**
 * How long the readiness probe waits for `SELECT 1` before calling the
 * database unreachable. Short on purpose: a pool with no free connection does
 * not reject, it queues, so without a ceiling here the probe inherits the
 * orchestrator's own (much longer) timeout and the instance keeps taking
 * traffic it cannot serve for that whole window.
 */
const READY_DB_TIMEOUT_MS = 2000;

/** Default ceiling on a graceful shutdown -- see closeWithTimeout. */
export const SHUTDOWN_TIMEOUT_MS = 12_000;

/** The subset of a request the log line is built from. Declared structurally
 * rather than as FastifyRequest so the serializer can be called directly in a
 * test without constructing a whole request. */
interface LoggableRequest {
  method?: string;
  url?: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

/**
 * Strips the credential out of the two URL paths that carry one.
 *
 * `/podcast/:token/...` is a bearer token for the full audio of someone's
 * library that survives a password change, and `/api/public/shares/:slug` is
 * the entire access control for a share page -- both are in the path, so
 * pino's default `req.url` writes them at info level on every hit. A podcast
 * client polls the feed several times an hour forever, which means the log
 * stream (typically a third-party aggregator with a much broader access list
 * than the database) accumulates working credentials indefinitely.
 * routes/api-tokens.ts already refuses to let a feed token hold write scope
 * precisely because it "ends up in client databases, sync services and access
 * logs"; this is the same reasoning applied to our own logs.
 *
 * Only the secret segment goes, never the whole path: a log of
 * `/[redacted]/[redacted]` cannot answer which route 500'd, so it would be
 * traded for a different kind of useless.
 */
export function redactSecretPathSegments(url: string): string {
  return url
    .replace(/^\/podcast\/[^/?#]+/, "/podcast/[redacted]")
    .replace(/^\/api\/public\/shares\/[^/?#]+/, "/api/public/shares/[redacted]");
}

/** Replaces pino's default `req` serializer; same fields, redacted url. */
export function redactedRequestSerializer(request: LoggableRequest): {
  method?: string;
  url?: string;
  host?: string;
  remoteAddress?: string;
  remotePort?: number;
} {
  return {
    method: request.method,
    url: request.url ? redactSecretPathSegments(request.url) : request.url,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

export interface BuildAppOptions {
  /** Replaces the built-in logger. Only used by tests, which need to read
   * back what was logged; passing one also opts out of the redacting
   * serializer below, so anything asserting on redaction must call
   * redactedRequestSerializer directly. */
  loggerInstance?: FastifyBaseLogger;
}

/**
 * Builds a fully-configured Fastify instance without binding a port -- the
 * split from index.ts exists so tests can `.inject()` requests directly
 * against a real app instance (routes, plugins, error handler, all of it)
 * instead of needing a live server listening on a real socket.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
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
  //
  // Neither wrong answer announces itself: rate limiting keeps returning 200s
  // either way, so the first signal is users being locked out, or none being
  // limited at all. Nothing in the process can tell what is in front of it,
  // so the two log lines below are the fix -- the resolved value at startup,
  // and what the first real request actually looked like. Reading them
  // together is what shows the mismatch: X-Forwarded-For present while
  // trustProxy is off means every one of those users is sharing a bucket;
  // absent while it is on means anyone can mint a fresh identity per request.
  const trustProxy = process.env.TRUST_PROXY === "true";
  const app = Fastify({
    trustProxy,
    // Explicit false, because Fastify's default is not the graceful option it
    // reads as. Left unset it resolves to "idle", and "idle" only calls
    // closeIdleConnections() when a custom serverFactory is in use -- on the
    // built-in server it falls through to closeAllConnections(), which
    // destroys sockets that are mid-response too (fastify.js's onClose, this
    // version). That turns index.ts's SIGTERM drain back into the severed
    // connection it exists to prevent. With false, server.close() stops
    // accepting, Node >=19 ends idle keep-alive sockets itself, and requests
    // already being served run to completion -- bounded by closeWithTimeout.
    forceCloseConnections: false,
    ...(options.loggerInstance
      ? { loggerInstance: options.loggerInstance }
      : {
          logger:
            process.env.NODE_ENV === "test"
              ? false
              : { serializers: { req: redactedRequestSerializer } },
        }),
  });

  app.log.info(
    { trustProxy, TRUST_PROXY: process.env.TRUST_PROXY ?? "unset" },
    "startup: trust proxy resolved -- request.ip is the client's address only if this matches your deployment",
  );

  let loggedProxyShape = false;
  app.addHook("onRequest", async (request) => {
    if (loggedProxyShape) return;
    loggedProxyShape = true;
    request.log.info(
      {
        trustProxy,
        xForwardedFor: request.headers["x-forwarded-for"] !== undefined,
        ip: request.ip,
      },
      "startup: first request proxy shape -- ip is what every rate limit keys on",
    );
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
  // Configurable because the e2e suite drives the entire app from a single
  // IP address in a couple of minutes -- exactly the shape this limit exists
  // to stop, and it will trip on a large enough suite even though nothing is
  // wrong. Raising it there beats the alternatives (per-test IP spoofing, or
  // discovering it as an intermittent 429 in one unlucky spec).
  await app.register(rateLimit, {
    max: Number(process.env.GLOBAL_RATE_LIMIT_MAX) || 300,
    timeWindow: "1 minute",
  });

  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 }, // 100MB, matches the web upload UI's stated limit
  });

  await setupAuthContext(app);

  // Liveness. Deliberately process-local and dependency-free: this answers
  // "is this process still able to run code", and a restart is the only
  // sensible response to it failing. Wiring a database check in here would
  // make a Postgres blip roll the entire fleet, turning a recoverable
  // dependency outage into an outage of everything.
  app.get("/api/health", async (): Promise<HealthResponse> => {
    return { status: "ok", timestamp: new Date().toISOString(), tts: ttsPoolStatus() };
  });

  // Readiness, which is a different question: "can this instance serve a real
  // request right now". Every route below needs Postgres, so an instance
  // whose credentials have rotated or whose pool is exhausted 500s on
  // everything while /api/health stays green -- and a rolling deploy reads
  // that green and drains the last instance that still worked. This is the
  // endpoint a load balancer should gate traffic on.
  app.get("/api/ready", async (_request, reply) => {
    const timestamp = new Date().toISOString();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`database did not answer within ${READY_DB_TIMEOUT_MS}ms`)),
            READY_DB_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: "ready", timestamp };
    } catch (err) {
      // The detail goes to the log, not the response: this route is
      // unauthenticated by necessity (a probe cannot log in) and Postgres
      // errors name hosts, ports and usernames.
      app.log.error({ err }, "readiness probe failed");
      reply.code(503);
      return { status: "unavailable", timestamp, error: "database_unreachable" };
    } finally {
      clearTimeout(timer);
    }
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
  await registerShareRoutes(app);
  await registerPodcastRoutes(app);

  return app;
}

/**
 * Closes the server, letting in-flight requests finish, but never taking
 * longer than `timeoutMs`.
 *
 * Both halves are load-bearing. Without the close, a deploy's SIGTERM cuts
 * every open response mid-write: an upload is lost, a migration batch stops
 * mid-write, and a podcast episode being written to disk leaves a truncated
 * WAV that an ArticleAudio row already points at -- which no client detects,
 * because a short WAV is a valid WAV, so it just plays as an episode that
 * ends early. Without the ceiling, one connection that never goes idle holds
 * the process open until the platform's own kill timer fires, which lands
 * back on the same severed-connection behaviour after a long stall.
 *
 * Never throws: the caller's next step is flushing telemetry and exiting, and
 * a failed close must not skip that.
 */
export async function closeWithTimeout(
  app: FastifyInstance,
  timeoutMs: number = SHUTDOWN_TIMEOUT_MS,
): Promise<"closed" | "timed-out" | "failed"> {
  let timer: NodeJS.Timeout | undefined;
  // Node only ends the keep-alive sockets that were *already* idle when
  // close() was called. A client whose request was in flight goes idle a
  // moment later, having got its response, and then holds the server open for
  // the full keepAliveTimeout (72s) -- so the drain below would hit its own
  // ceiling on an app with nothing left to serve, and every deploy would take
  // the timeout. Sweeping while closing reaps each connection as it finishes.
  const reapIdle = setInterval(() => app.server?.closeIdleConnections?.(), 50);
  reapIdle.unref();
  try {
    return await Promise.race([
      app.close().then(
        () => "closed" as const,
        (err: unknown) => {
          app.log.error({ err }, "shutdown: server close failed");
          return "failed" as const;
        },
      ),
      new Promise<"timed-out">((resolve) => {
        timer = setTimeout(() => resolve("timed-out"), timeoutMs);
      }),
    ]);
  } finally {
    clearInterval(reapIdle);
    clearTimeout(timer);
  }
}
