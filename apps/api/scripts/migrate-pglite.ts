// Applies prisma/migrations/* directly over the `pg` wire protocol.
//
// Why this exists: `prisma migrate dev` / `migrate deploy` talk to the
// database through Prisma's native Rust engine, which the pglite-socket dev
// database (see dev-db.ts) doesn't speak reliably. This script applies the
// same migration.sql files Prisma generates, using the plain JS `pg` driver
// instead, and records them in `_prisma_migrations` in the same shape Prisma
// itself uses -- so `prisma migrate status` still reports correctly.
//
// Against a real Postgres instance, prefer `prisma migrate deploy` -- this
// script is only needed for the pglite dev database.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

try {
  process.loadEnvFile();
} catch {
  // no .env file present -- fine in environments where real env vars are set directly
}

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma",
  "migrations",
);

const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL PRIMARY KEY,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  );
`);

const { rows: applied } = await client.query<{ migration_name: string }>(
  `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
);
const appliedNames = new Set(applied.map((row) => row.migration_name));

for (const folder of migrationFolders) {
  if (appliedNames.has(folder)) {
    console.log(`[migrate] ${folder} already applied, skipping`);
    continue;
  }

  const sqlPath = path.join(migrationsDir, folder, "migration.sql");
  const sql = readFileSync(sqlPath, "utf-8");
  const checksum = createHash("sha256").update(sql).digest("hex");

  console.log(`[migrate] applying ${folder}`);
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      `INSERT INTO "_prisma_migrations"
        (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, $1, $2, now(), now(), 1)`,
      [checksum, folder],
    );
    await client.query("COMMIT");
    console.log(`[migrate] applied ${folder}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

await client.end();
console.log("[migrate] done");
