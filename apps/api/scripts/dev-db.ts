// Local dev database: a persisted, Postgres-wire-compatible server backed by
// PGlite. This exists so `pnpm dev:db` gives every contributor a real
// Postgres to point DATABASE_URL at without installing Postgres or Docker.
// Not used in production -- production points DATABASE_URL at a real Postgres.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".pglite-data",
);

const port = Number(process.env.PGLITE_PORT ?? 5432);
const host = process.env.PGLITE_HOST ?? "127.0.0.1";

const db = new PGlite({ dataDir });
await db.waitReady;

const server = new PGLiteSocketServer({
  db,
  port,
  host,
  maxConnections: 20,
  debug: process.env.PGLITE_DEBUG === "1",
});
await server.start();

console.log(`[dev-db] listening on postgresql://${host}:${port}`);
console.log(`[dev-db] data persisted to ${dataDir}`);

async function shutdown() {
  console.log("\n[dev-db] shutting down");
  await server.stop();
  await db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
