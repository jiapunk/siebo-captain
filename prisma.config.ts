// Prisma CLI 設定（prisma migrate / studio / generate 都會讀這支）
// .env 由 dotenv 載入；全新 clone 沒有 .env 時退回 file:./dev.db，不再直接丟 PrismaConfigEnvError
import "dotenv/config";
import { defineConfig } from "prisma/config";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:./dev.db";
  console.warn(
    "[prisma.config] 未設定 DATABASE_URL，退回 file:./dev.db（建議先跑 node scripts/ensure-env.mjs 建立 .env）",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
