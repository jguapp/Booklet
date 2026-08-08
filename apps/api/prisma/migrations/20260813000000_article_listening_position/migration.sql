-- Read-aloud position, synced across devices (#152). All three are nullable
-- with no default: an article nobody has ever listened to must be
-- distinguishable from one paused at the very beginning, or the resume prompt
-- fires on everything. See schema.prisma for why this is a fraction rather
-- than a chunk index.

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "listeningFraction" DOUBLE PRECISION,
ADD COLUMN     "listeningUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "listeningDeviceId" TEXT;
