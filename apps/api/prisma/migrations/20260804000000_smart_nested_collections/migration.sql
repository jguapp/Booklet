-- AlterTable
ALTER TABLE "Collection" ADD COLUMN "filter" JSONB;
ALTER TABLE "Collection" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Collection_userId_parentId_idx" ON "Collection"("userId", "parentId");

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
