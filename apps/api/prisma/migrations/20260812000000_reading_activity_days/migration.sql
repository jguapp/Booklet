-- CreateTable
CREATE TABLE "ReadingActivityDay" (
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReadingActivityDay_pkey" PRIMARY KEY ("userId","date")
);

-- AddForeignKey
ALTER TABLE "ReadingActivityDay" ADD CONSTRAINT "ReadingActivityDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
