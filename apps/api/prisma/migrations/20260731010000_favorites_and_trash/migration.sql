-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "favorited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Article_userId_favorited_idx" ON "Article"("userId", "favorited");

-- CreateIndex
CREATE INDEX "Article_userId_deletedAt_idx" ON "Article"("userId", "deletedAt");
