-- Highlight.color: enum -> text, so a highlight color can be any
-- #RRGGBB hex value the user picked, not just one of a fixed set of five.
-- Existing rows keep their literal value ("YELLOW", "GREEN", etc.) as
-- plain text -- Postgres enum values are stored as text under the hood, so
-- this preserves every existing highlight's color exactly as it was; the
-- application layer (packages/shared highlight-colors.ts) still treats
-- those five names as valid, theme-adaptive colors going forward.
ALTER TABLE "Highlight" ALTER COLUMN "color" DROP DEFAULT;
ALTER TABLE "Highlight" ALTER COLUMN "color" TYPE TEXT USING "color"::TEXT;
ALTER TABLE "Highlight" ALTER COLUMN "color" SET DEFAULT 'YELLOW';

DROP TYPE "HighlightColor";
