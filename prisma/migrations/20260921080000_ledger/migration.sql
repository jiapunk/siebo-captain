-- CreateTable
CREATE TABLE "LedgerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" REAL NOT NULL DEFAULT 1,
    "refId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "LedgerEvent_userId_idx" ON "LedgerEvent"("userId");

-- CreateIndex
CREATE INDEX "LedgerEvent_kind_idx" ON "LedgerEvent"("kind");

