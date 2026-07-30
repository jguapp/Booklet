-- AlterTable
ALTER TABLE "Article" ADD COLUMN "canonicalUrl" TEXT;

-- CreateIndex
CREATE INDEX "Article_userId_canonicalUrl_idx" ON "Article"("userId", "canonicalUrl");
