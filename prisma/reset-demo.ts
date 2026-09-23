import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { absoluteDatabaseUrl, databaseUrl, isDevDbUrl } from "./db-path";

/**
 * 清空 demo 產生的資料（保留種子用戶與活動），回到初始展示狀態。
 * ⚠ 會刪除所有非種子（真人）帳號與全部互盤/隊伍資料。
 *
 * 防呆：DATABASE_URL 指向 prisma/dev.db（現場 demo 資料）時拒絕執行，
 * 除非明確帶 --allow-dev-db（npm run demo:reset 會帶）。測試請用獨立 DB（playwright.config.ts 已設定）。
 */
const url = databaseUrl();
if (isDevDbUrl(url) && !process.argv.includes("--allow-dev-db")) {
  console.error(
    `[reset-demo] 拒絕執行：DATABASE_URL（${url}）指向 prisma/dev.db（demo 資料）。` +
      "確定要清空現場資料請用 npm run demo:reset（或加 --allow-dev-db）。",
  );
  process.exit(1);
}

// 用絕對路徑開檔：實際清空的就是上面檢查過的那個檔案
const prisma = new PrismaClient({ datasourceUrl: absoluteDatabaseUrl(url) });

async function main() {
  await prisma.$transaction([
    prisma.ledgerEvent.deleteMany(),
    prisma.connectMessage.deleteMany(),
    prisma.connection.deleteMany(),
    prisma.teamMessage.deleteMany(),
    prisma.teamMember.deleteMany(),
    prisma.team.deleteMany(),
    prisma.icebreaker.deleteMany(),
    prisma.swarmPart.deleteMany(),
    prisma.soloBaseline.deleteMany(),
    prisma.matchRun.deleteMany(),
    prisma.eventMember.deleteMany({
      where: { user: { isBot: false, id: { not: { startsWith: "seed-" } } } },
    }),
    prisma.agentProfile.deleteMany({
      where: { user: { isBot: false, id: { not: { startsWith: "seed-" } } } },
    }),
    prisma.user.deleteMany({
      where: { isBot: false, id: { not: { startsWith: "seed-" } } },
    }),
  ]);
  console.log("Demo data reset. Seed participants preserved.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
