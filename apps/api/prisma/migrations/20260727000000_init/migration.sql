-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('UNREAD', 'READING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('HTML', 'PDF', 'EPUB');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "HighlightColor" AS ENUM ('YELLOW', 'GREEN', 'BLUE', 'PINK', 'ORANGE');

-- CreateEnum
CREATE TYPE "ResurfaceFeedback" AS ENUM ('REMEMBERED', 'FORGOT');

-- CreateEnum
CREATE TYPE "ResurfaceFrequency" AS ENUM ('DAILY', 'WEEKLY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resurfaceFrequency" "ResurfaceFrequency" NOT NULL DEFAULT 'DAILY',
    "highlightsPerDigest" INTEGER NOT NULL DEFAULT 5,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "author" TEXT,
    "siteName" TEXT,
    "excerpt" TEXT,
    "sourceType" "SourceType" NOT NULL DEFAULT 'HTML',
    "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "extractionError" TEXT,
    "extractedHtml" TEXT,
    "extractedText" TEXT,
    "fileStorageKey" TEXT,
    "originalFilename" TEXT,
    "readingTimeEstimate" INTEGER,
    "progressFraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ArticleStatus" NOT NULL DEFAULT 'UNREAD',
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Highlight" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "selectedText" TEXT NOT NULL,
    "position" JSONB NOT NULL,
    "color" "HighlightColor" NOT NULL DEFAULT 'YELLOW',
    "lastSurfacedAt" TIMESTAMP(3),
    "surfaceCount" INTEGER NOT NULL DEFAULT 0,
    "lastFeedback" "ResurfaceFeedback",
    "lastFeedbackAt" TIMESTAMP(3),
    "resurfaceArchivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Highlight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Digest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),
    "emailSentAt" TIMESTAMP(3),

    CONSTRAINT "Digest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "highlightId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleCollection" (
    "articleId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleCollection_pkey" PRIMARY KEY ("articleId","collectionId")
);

-- CreateTable
CREATE TABLE "_DigestToHighlight" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DigestToHighlight_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Article_userId_status_idx" ON "Article"("userId", "status");

-- CreateIndex
CREATE INDEX "Article_userId_savedAt_idx" ON "Article"("userId", "savedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Article_userId_url_key" ON "Article"("userId", "url");

-- CreateIndex
CREATE INDEX "Highlight_articleId_idx" ON "Highlight"("articleId");

-- CreateIndex
CREATE INDEX "Highlight_userId_createdAt_idx" ON "Highlight"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Digest_userId_generatedAt_idx" ON "Digest"("userId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Annotation_highlightId_key" ON "Annotation"("highlightId");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_userId_name_key" ON "Collection"("userId", "name");

-- CreateIndex
CREATE INDEX "_DigestToHighlight_B_index" ON "_DigestToHighlight"("B");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Highlight" ADD CONSTRAINT "Highlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Digest" ADD CONSTRAINT "Digest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_highlightId_fkey" FOREIGN KEY ("highlightId") REFERENCES "Highlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCollection" ADD CONSTRAINT "ArticleCollection_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleCollection" ADD CONSTRAINT "ArticleCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DigestToHighlight" ADD CONSTRAINT "_DigestToHighlight_A_fkey" FOREIGN KEY ("A") REFERENCES "Digest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DigestToHighlight" ADD CONSTRAINT "_DigestToHighlight_B_fkey" FOREIGN KEY ("B") REFERENCES "Highlight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

