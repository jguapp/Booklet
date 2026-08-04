// Local dev database: a persisted, Postgres-wire-compatible server backed by
// PGlite. This exists so `pnpm dev:db` gives every contributor a real
// Postgres to point DATABASE_URL at without installing Postgres or Docker.
// Not used in production -- production points DATABASE_URL at a real Postgres.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(scriptsDir, "..", ".pglite-data");

const port = Number(process.env.PGLITE_PORT ?? 5432);
const host = process.env.PGLITE_HOST ?? "127.0.0.1";

// A `postmaster.pid` left behind by a non-graceful stop (SIGKILL, a crashed
// parent process, a machine sleep/restart mid-run -- none of which reach the
// SIGINT/SIGTERM handler below) can make the next start behave as though
// another instance is already running. Real Postgres in this situation, it
// isn't: dev-db.ts is a single-process, single-port server, and PGlite's
// data-file format itself is unaffected by a stray pid file. Safe to clear
// unconditionally on every start.
const pidFile = path.join(dataDir, "postmaster.pid");
if (existsSync(pidFile)) {
  console.log("[dev-db] clearing a stale postmaster.pid from a previous unclean shutdown");
  await rm(pidFile, { force: true });
}

// A harder failure mode than the stale pid file above: PGlite's WASM engine
// can abort outright (`RuntimeError: Aborted()`) trying to load data left in
// a torn state by the same kind of non-graceful stop -- observed for real,
// more than once, in exactly this repo's dev history (see the
// `.pglite-data.crashed-*` / `.corrupted-backup-*` directories this same
// recovery has produced by hand before). Restarting against the same data
// fails identically every time; the fix isn't a retry, it's a fresh
// database. The old one is backed up, not deleted -- it's unreadable by this
// engine, but the raw files might still matter to someone chasing exactly
// what went wrong.
async function openDatabase(): Promise<{ db: PGlite; needsMigration: boolean }> {
  try {
    const db = new PGlite({ dataDir });
    await db.waitReady;
    return { db, needsMigration: false };
  } catch (err) {
    if (!existsSync(dataDir)) throw err; // nothing to recover from -- a real, different problem
    console.error(`[dev-db] existing data at ${dataDir} won't load: ${err instanceof Error ? err.message : err}`);
    const backupDir = `${dataDir}.corrupted-backup-${Date.now()}`;
    console.log(`[dev-db] backing up to ${backupDir} and starting fresh`);
    await rename(dataDir, backupDir);

    const db = new PGlite({ dataDir });
    await db.waitReady;
    return { db, needsMigration: true };
  }
}

const { db, needsMigration } = await openDatabase();

const server = new PGLiteSocketServer({
  db,
  port,
  host,
  maxConnections: 20,
  debug: process.env.PGLITE_DEBUG === "1",
});
await server.start();

// Only reachable now that the socket server above is actually listening --
// migrate-pglite.ts is a separate process that connects to this server over
// the real wire protocol (see its own header comment for why: Prisma's
// engine doesn't speak PGlite's socket reliably, so it uses the plain `pg`
// driver instead), so running it any earlier just fails to connect. A fresh
// PGlite has no schema -- every route would 500 the instant anything
// queries it -- so this is what makes the recovery above an actual recovery
// instead of trading one broken state for another.
//
// execFile, not execFileSync: this process's own event loop is what's
// actually accepting the migration subprocess's incoming connection (the
// PGLiteSocketServer above runs in-process, not as a separate server) --
// synchronously blocking this process to wait for that subprocess is a
// deadlock, confirmed by hand (the migration hung forever, never even
// reaching the connection attempt, until this was switched to async).
if (needsMigration) {
  console.log("[dev-db] fresh database has no schema yet -- applying migrations");
  // tsx's own CLI entry point, resolved through node_modules rather than the
  // `tsx` shell command, so this doesn't depend on PATH resolution -- the
  // same class of problem this whole recovery path exists to route around.
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  const { stdout, stderr } = await execFileAsync(process.execPath, [tsxCli, path.join(scriptsDir, "migrate-pglite.ts")], {
    env: { ...process.env, DATABASE_URL: `postgresql://${host}:${port}/postgres` },
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

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
