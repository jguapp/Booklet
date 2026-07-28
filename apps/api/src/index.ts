import Fastify, { type FastifyError } from "fastify";
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
import { captureException, initErrorMonitoring } from "./lib/error-monitoring.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file present -- fine in environments where real env vars are set directly
}

initErrorMonitoring();

const app = Fastify({ logger: true });

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
await app.register(cors, {
  origin: isDev
    ? /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/
    : (process.env.WEB_ORIGIN ?? false),
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

const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
