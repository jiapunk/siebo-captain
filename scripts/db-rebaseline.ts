import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PRISMA_DIR, databaseUrl, sqlitePathFromUrl } from "../prisma/db-path";

/**
 * 既有 DB 對齊新的 baseline migration
 *   npm run db:rebaseline              # 對 DATABASE_URL（預設 prisma/dev.db）執行
 *   npm run db:rebaseline -- --dry-run # 只檢查、印出狀態，不寫入
 *
 * 背景：舊的 10 支 migration 在空 DB 上無法重放（順序錯置、swarm_parts 被覆寫），
 * 已改成單一 prisma/migrations/<ts>_baseline。用舊歷史建立的 DB（例如 demo 用的 dev.db）
 * schema 其實已經正確，只是 _prisma_migrations 還記著舊的 10 筆。
 *
 * 這支腳本：
 *   1. 先用 `prisma migrate diff --from-url <db> --to-schema-datamodel` 確認 DB schema 與 schema.prisma 一致（不一致就中止）
 *   2. 在單一交易內把 _prisma_migrations 改寫成只有 baseline 一筆
 *      （checksum = migration.sql 的 sha256 hex、finished_at = now、applied_steps_count = 1）
 *   3. 只動 _prisma_migrations，其他資料表一筆都不碰（前後筆數比對，不符就報錯）
 * 可重複執行：已對齊時直接略過。
 */

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = resolve(PRISMA_DIR, "..");
const MIGRATIONS_DIR = join(PRISMA_DIR, "migrations");
const SCHEMA_PATH = join(PRISMA_DIR, "schema.prisma");

type MigrationRow = {
  migration_name: string;
  checksum: string;
  finished_at: number | bigint | string | null;
  rolled_back_at: number | bigint | string | null;
  applied_steps_count: number | bigint;
};

function fail(msg: string): never {
  console.error(`[rebaseline] ✗ ${msg}`);
  process.exit(1);
}

function findBaseline(): { name: string; checksum: string } {
  const dirs = readdirSync(MIGRATIONS_DIR).filter((d) =>
    statSync(join(MIGRATIONS_DIR, d)).isDirectory(),
  );
  const baselines = dirs.filter((d) => d.endsWith("_baseline"));
  if (baselines.length !== 1) fail(`prisma/migrations 應有且只有一個 *_baseline 目錄，實際：${baselines.join(", ") || "無"}`);
  const others = dirs.filter((d) => d !== baselines[0]);
  if (others.length) fail(`prisma/migrations 除了 baseline 還有其他 migration（${others.join(", ")}）；這支腳本只處理 baseline 對齊`);
  const sql = readFileSync(join(MIGRATIONS_DIR, baselines[0], "migration.sql"));
  return { name: baselines[0], checksum: createHash("sha256").update(sql).digest("hex") };
}

/** DB schema 與 schema.prisma 是否一致（忽略 _prisma_migrations） */
function schemaMatches(url: string): boolean {
  // --no：只用專案內的 prisma CLI，絕不臨時下載
  const r = spawnSync(
    "npx",
    ["--no", "prisma", "migrate", "diff", "--from-url", url, "--to-schema-datamodel", SCHEMA_PATH, "--script", "--exit-code"],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, DATABASE_URL: url } },
  );
  if (r.status === 0) return true;
  if (r.status === 2) {
    console.error("[rebaseline] DB schema 與 schema.prisma 不一致，差異如下：");
    console.error(r.stdout.trim());
    return false;
  }
  fail(`prisma migrate diff 執行失敗（exit=${r.status}）：${(r.stderr || r.stdout).trim()}`);
}

function fmt(v: number | bigint | string | null): string {
  if (v === null) return "null";
  const n = Number(v);
  return Number.isFinite(n) && n > 1e11 ? new Date(n).toISOString() : String(v);
}

function printRows(label: string, rows: MigrationRow[]) {
  console.log(`[rebaseline] ${label}：_prisma_migrations ${rows.length} 筆`);
  for (const r of rows)
    console.log(
      `  - ${r.migration_name}  checksum=${r.checksum.slice(0, 12)}  finished_at=${fmt(r.finished_at)}  rolled_back_at=${fmt(r.rolled_back_at)}  steps=${Number(r.applied_steps_count)}`,
    );
}

async function main() {
  const url = databaseUrl();
  const dbPath = sqlitePathFromUrl(url);
  if (!dbPath) fail(`只支援 SQLite（file:）DATABASE_URL，目前是：${url}`);
  if (!existsSync(dbPath)) fail(`找不到資料庫檔案：${dbPath}`);
  const absUrl = `file:${dbPath}`;
  const baseline = findBaseline();

  console.log(`[rebaseline] DB：${dbPath}`);
  console.log(`[rebaseline] baseline：${baseline.name}（sha256 ${baseline.checksum.slice(0, 12)}…）`);

  if (!schemaMatches(absUrl)) fail("DB schema 未對齊，拒絕改寫 migration 紀錄（請先確認這是用舊歷史建立的正確 DB）");
  console.log("[rebaseline] ✓ DB schema 與 schema.prisma 一致");

  const prisma = new PrismaClient({ datasourceUrl: absUrl });
  try {
    const tables = (
      await prisma.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name",
      )
    ).map((t) => t.name);
    const countAll = async () => {
      const out: Record<string, number> = {};
      for (const t of tables) {
        const [row] = await prisma.$queryRawUnsafe<{ c: number | bigint }[]>(`SELECT COUNT(*) AS c FROM "${t}"`);
        out[t] = Number(row.c);
      }
      return out;
    };

    const hasTable =
      (
        await prisma.$queryRawUnsafe<{ name: string }[]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'",
        )
      ).length > 0;
    const readRows = () =>
      prisma.$queryRawUnsafe<MigrationRow[]>(
        "SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at",
      );

    const before = hasTable ? await readRows() : [];
    printRows("改寫前", before);

    const aligned =
      before.length === 1 &&
      before[0].migration_name === baseline.name &&
      before[0].checksum === baseline.checksum &&
      before[0].finished_at !== null &&
      before[0].rolled_back_at === null &&
      Number(before[0].applied_steps_count) === 1;
    if (aligned) {
      console.log("[rebaseline] ✓ 已對齊 baseline，不需變更");
      return;
    }
    if (DRY_RUN) {
      console.log(`[rebaseline] --dry-run：將改寫為只有 ${baseline.name} 一筆（未寫入）`);
      return;
    }

    const countsBefore = await countAll();

    // 改寫前留一份備份（prisma/*.db* 已被 .gitignore）
    const backup = `${dbPath}.pre-rebaseline.bak`;
    if (!existsSync(backup)) {
      copyFileSync(dbPath, backup);
      console.log(`[rebaseline] 已備份：${backup}`);
    }

    const now = Date.now();
    await prisma.$transaction([
      // 與 Prisma migrate 引擎建立的表結構相同；DB 若是 db push 建的就補建
      prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`),
      prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations"`),
      prisma.$executeRawUnsafe(
        `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count") VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
        randomUUID(),
        baseline.checksum,
        now,
        baseline.name,
        now,
      ),
    ]);

    printRows("改寫後", await readRows());

    const countsAfter = await countAll();
    const changed = tables.filter((t) => countsBefore[t] !== countsAfter[t]);
    if (changed.length) fail(`資料表筆數有變動：${changed.join(", ")}`);
    console.log(
      `[rebaseline] ✓ 完成；資料表筆數未變（${tables.map((t) => `${t}=${countsAfter[t]}`).join(" ")}）`,
    );
    console.log("[rebaseline] 可用 `npx prisma migrate status` 確認 up to date");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
