-- Ranked full-text search (#155).
--
-- A GENERATED ... STORED column rather than a trigger or an
-- application-maintained one: it cannot drift from the row it describes,
-- because there is no write path that could forget to update it. Every
-- existing row is backfilled by Postgres as part of adding the column, so
-- there is no separate backfill step and no window where search is
-- half-populated.
--
-- The expression must be IMMUTABLE for a generated column, which is why the
-- text-search config is the literal 'english' rather than the session
-- default: to_tsvector(regconfig, text) is immutable, while the
-- one-argument to_tsvector(text) depends on a GUC and is only stable.
--
-- Weights, highest first, are what make ts_rank order results the way a
-- reader would expect rather than by where in the document a term happened
-- to appear:
--   A  title      -- what the article is called
--   B  author, siteName  -- how someone refers to it from outside
--   C  excerpt    -- the summary
--   D  extractedText -- the body; matched, but never outranks a title hit
--
-- `tags` is deliberately absent, and not by preference: array_to_string is
-- STABLE rather than IMMUTABLE (it goes through per-type output functions),
-- so including it is rejected outright with "generation expression is not
-- immutable". Tags stay matched by the exact-array condition the search
-- route already used, which is the behaviour a tag is meant to have anyway
-- -- an exact label, not a stemmed free-text term.
ALTER TABLE "Article"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("author", '') || ' ' || coalesce("siteName", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("excerpt", '')), 'C') ||
    setweight(to_tsvector('english', coalesce("extractedText", '')), 'D')
  ) STORED;

-- GIN rather than GiST: this table is read far more than written, and GIN is
-- the faster of the two for lookups at the cost of a slower build, which is
-- the right trade for a personal library that is searched constantly and
-- appended to occasionally.
CREATE INDEX "Article_searchVector_idx" ON "Article" USING GIN ("searchVector");
