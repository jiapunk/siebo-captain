import "dotenv/config";
import { copyFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { absoluteDatabaseUrl, databaseUrl, isDevDbUrl, sqlitePathFromUrl } from "../prisma/db-path";
import { ORPHAN_RULES, orphanCountSql, orphanDeleteSql } from "../prisma/orphans";

/**
 * 清掉既有 DB 裡的孤兒資料（指向已不存在 MatchRun／User 的 SwarmPart、Icebreaker、SoloBaseline）
 *   npm run db:prune-orphans              # 對 DATABASE_URL（預設 prisma/dev.db）執行
 *   npm run db:prune-orphans -- --dry-run # 只列出各規則命中筆數，不寫入
 *
 * 背景：這些欄位沒有 FK（見 prisma/schema.prisma、prisma/orphans.ts）。舊版 reset-demo 只刪 MatchRun、
 * 不清 SwarmPart，留下 2,430 筆 pair part 孤兒；demo 快照把它們存起來，每次 demo:restore 又帶回來。
 * 現行程式的刪除路徑（deleteUserAndData、seed、reset-demo）都會一起清，不會再產生新的孤兒。
 *
 * - 只刪 ORPHAN_RULES 命中的列；讀取端本來就以 runId／h:<userId> 過濾，所以畫面與 API 結果不變
 * - 單一交易；刪除前備份為 <db>.pre-prune.bak（已存在就不覆蓋，保留最早的狀態）
 * - 事後核對：規則命中數歸零、各表減少的筆數等於刪除數、其他資料表筆數不變
 * - 可重複執行：沒有孤兒時直接略過
 * - 防呆：DATABASE_URL 指向 prisma/dev.db 時需帶 --allow-dev-db（npm script 與 demo:restore 會帶）
 */

const DRY_RUN = process.argv.includes("--dry-run");

function fail(msg: string): never {
  console.error(`[prune-orphans] ✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const url = databaseUrl();
  const dbPath = sqlitePathFromUrl(url);
  if (!dbPath) fail(`只支援 SQLite（file:）DATABASE_URL，目前是：${url}`);
  if (!existsSync(dbPath)) fail(`找不到資料庫檔案：${dbPath}`);
  if (!DRY_RUN && isDevDbUrl(url) && !process.argv.includes("--allow-dev-db"))
    fail(
      `DATABASE_URL（${url}）指向 prisma/dev.db（demo 資料）；確定要清孤兒請用 npm run db:prune-orphans（或加 --allow-dev-db）`,
    );

  console.log(`[prune-orphans] DB：${dbPath}`);
  const prisma = new PrismaClient({ datasourceUrl: absoluteDatabaseUrl(`file:${dbPath}`) });
  try {
    const tables = (
      await prisma.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
    ).map((t) => t.name);
    const missing = [...new Set(ORPHAN_RULES.map((r) => r.table))].filter((t) => !tables.includes(t));
    if (missing.length) fail(`DB 缺少資料表：${missing.join(", ")}（先跑 npm run db:migrate）`);

    const countRule = async (sql: string) =>
      Number((await prisma.$queryRawUnsafe<{ c: number | bigint }[]>(sql))[0].c);
    const countAll = async () => {
      const out: Record<string, number> = {};
      for (const t of tables) out[t] = await countRule(`SELECT COUNT(*) AS c FROM "${t}"`);
      return out;
    };

    const hits: { rule: (typeof ORPHAN_RULES)[number]; n: number }[] = [];
    for (const rule of ORPHAN_RULES) hits.push({ rule, n: await countRule(orphanCountSql(rule)) });
    for (const { rule, n } of hits) console.log(`  - ${rule.label}：${n}`);
    const total = hits.reduce((s, h) => s + h.n, 0);
    if (total === 0) {
      console.log("[prune-orphans] ✓ 沒有孤兒資料，不需變更");
      return;
    }
    if (DRY_RUN) {
      console.log(`[prune-orphans] --dry-run：將刪除 ${total} 筆（未寫入）`);
      return;
    }

    const before = await countAll();
    const backup = `${dbPath}.pre-prune.bak`;
    if (!existsSync(backup)) {
      copyFileSync(dbPath, backup);
      console.log(`[prune-orphans] 已備份：${backup}`);
    }

    const deleted = await prisma.$transaction(ORPHAN_RULES.map((r) => prisma.$executeRawUnsafe(orphanDeleteSql(r))));

    // 事後核對：規則命中歸零、各表減少數 = 刪除數、其他表不變
    for (const rule of ORPHAN_RULES) {
      const left = await countRule(orphanCountSql(rule));
      if (left !== 0) fail(`刪除後仍有 ${left} 筆命中：${rule.label}`);
    }
    const expectedDrop: Record<string, number> = {};
    ORPHAN_RULES.forEach((r, i) => (expectedDrop[r.table] = (expectedDrop[r.table] ?? 0) + deleted[i]));
    const after = await countAll();
    const wrong = tables.filter((t) => before[t] - after[t] !== (expectedDrop[t] ?? 0));
    if (wrong.length) fail(`資料表筆數變動與預期不符：${wrong.join(", ")}`);

    console.log(
      `[prune-orphans] ✓ 已刪除 ${deleted.reduce((s, n) => s + n, 0)} 筆孤兒；` +
        Object.keys(expectedDrop)
          .map((t) => `${t} ${before[t]} → ${after[t]}`)
          .join("、") +
        "；其他資料表筆數未變",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
