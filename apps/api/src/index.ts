import Fastify from "fastify";
import cors from "@fastify/cors";
import type { HealthResponse } from "@booklet/shared";

try {
  process.loadEnvFile();
} catch {
  // no .env file present -- fine in environments where real env vars are set directly
}

const app = Fastify({ logger: true });

const isDev = process.env.NODE_ENV !== "production";

// Next.js picks the next free port (3001, 3002, ...) when 3000 is taken, so a
// fixed origin string is brittle in dev. Any localhost port is fine locally;
// production still pins to the one configured WEB_ORIGIN.
await app.register(cors, {
  origin: isDev
    ? /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/
    : (process.env.WEB_ORIGIN ?? false),
});

app.get("/api/health", async (): Promise<HealthResponse> => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
