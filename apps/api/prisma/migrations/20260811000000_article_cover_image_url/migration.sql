-- Article.coverImageUrl: a data: URI thumbnail for the library card
-- (og:image for HTML, rendered page 1 for PDF, declared/first-spine-image
-- cover for EPUB). Null for every existing row -- backfilling one would
-- mean re-extracting every saved article/file, not worth doing for a
-- purely cosmetic addition.
ALTER TABLE "Article" ADD COLUMN "coverImageUrl" TEXT;
