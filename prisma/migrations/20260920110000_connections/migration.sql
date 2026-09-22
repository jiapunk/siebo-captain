-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConnectMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConnectMessage_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Connection_userAId_idx" ON "Connection"("userAId");

-- CreateIndex
CREATE INDEX "Connection_userBId_idx" ON "Connection"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_userAId_userBId_key" ON "Connection"("userAId", "userBId");

-- CreateIndex
CREATE INDEX "ConnectMessage_connectionId_idx" ON "ConnectMessage"("connectionId");

