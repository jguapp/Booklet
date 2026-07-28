-- AlterTable
ALTER TABLE "Highlight" ADD COLUMN     "easinessFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
ADD COLUMN     "intervalDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextDueAt" TIMESTAMP(3),
ADD COLUMN     "repetitions" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Highlight_userId_nextDueAt_idx" ON "Highlight"("userId", "nextDueAt");

