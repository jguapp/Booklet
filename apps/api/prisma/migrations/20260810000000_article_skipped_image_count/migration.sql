-- Article.skippedImageCount: how many images in the original page were too
-- large/numerous to inline as data: URIs at save time and were left
-- pointing at the original site instead. Defaults to 0 for every existing
-- row -- backfilling a real count would require re-fetching every saved
-- page, which isn't worth doing for a purely informational notice.
ALTER TABLE "Article" ADD COLUMN "skippedImageCount" INTEGER NOT NULL DEFAULT 0;
