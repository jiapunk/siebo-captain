-- AlterTable
ALTER TABLE "MatchRun" ADD COLUMN "trace" JSONB;

-- CreateTable
CREATE TABLE "TeamHypothesis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT,
    "userId" TEXT NOT NULL,
    "memberIds" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'evaluated',
    "score" INTEGER NOT NULL,
    "evidence" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TeamHypothesis_userId_idx" ON "TeamHypothesis"("userId");

