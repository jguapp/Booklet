-- CreateTable
CREATE TABLE "ArticleEmbedding" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "vector" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleEmbedding_userId_idx" ON "ArticleEmbedding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleEmbedding_articleId_chunkIndex_key" ON "ArticleEmbedding"("articleId", "chunkIndex");

-- AddForeignKey
ALTER TABLE "ArticleEmbedding" ADD CONSTRAINT "ArticleEmbedding_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
