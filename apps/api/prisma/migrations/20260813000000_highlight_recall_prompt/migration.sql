-- AlterTable
-- Nullable with no default, so this is a metadata-only change in Postgres:
-- no table rewrite, no backfill, and every existing highlight keeps the
-- show-then-grade review behavior it already had.
ALTER TABLE "Highlight" ADD COLUMN "prompt" TEXT;
