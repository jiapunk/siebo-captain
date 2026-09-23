import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * demo 資料庫快照
 *   npm run demo:snapshot
 * 位置：prisma/demo-snapshots/demo.db（另存時間戳版本，保留最新 3 份）
 *
 * 首選 sqlite3 CLI 的 VACUUM INTO（一致性快照）：先寫到暫存檔再 rename 覆蓋，
 * 所以重複執行不會因「output file already exists」失敗，中途失敗也不會弄壞舊快照。
 * 只有「沒有 sqlite3 CLI」時才退回檔案複製（連同 -journal / -wal / -shm），並如實標示。
 */
const prismaDir = join(process.cwd(), "prisma");
const src = join(prismaDir, "dev.db");
if (!existsSync(src)) {
  console.error("找不到 prisma/dev.db——先跑 npm run setup（或 npm run db:seed）");
  process.exit(1);
}
const dir = join(prismaDir, "demo-snapshots");
mkdirSync(dir, { recursive: true });

const SIDE_FILES = ["-journal", "-wal", "-shm"];

function removeWithSideFiles(path: string) {
  for (const p of [path, ...SIDE_FILES.map((s) => `${path}${s}`)]) if (existsSync(p)) rmSync(p);
}

type Method = "VACUUM INTO" | "檔案複製";

function snapshotTo(dest: string): Method {
  const tmp = `${dest}.tmp`;
  removeWithSideFiles(tmp); // VACUUM INTO 的目標檔不可已存在
  const r = spawnSync("sqlite3", [src, `VACUUM INTO '${tmp.replace(/'/g, "''")}'`], {
    encoding: "utf8",
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") {
    // 沒有 sqlite3 CLI：退回檔案複製（不保證一致性；複製期間若有寫入可能不完整）
    removeWithSideFiles(dest);
    copyFileSync(src, dest);
    for (const suffix of SIDE_FILES)
      if (existsSync(`${src}${suffix}`)) copyFileSync(`${src}${suffix}`, `${dest}${suffix}`);
    return "檔案複製";
  }
  if (r.status !== 0) {
    removeWithSideFiles(tmp);
    console.error(`[demo] ✗ VACUUM INTO 失敗（exit=${r.status}）：${(r.stderr || "").trim()}`);
    console.error("[demo] 舊快照未被更動；請確認 dev.db 沒有被鎖住後重試");
    process.exit(1);
  }
  removeWithSideFiles(dest);
  renameSync(tmp, dest);
  return "VACUUM INTO";
}

const method = snapshotTo(join(dir, "demo.db"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
snapshotTo(join(dir, `demo-${stamp}.db`));

const keep = readdirSync(dir)
  .filter((f) => f.startsWith("demo-") && f.endsWith(".db"))
  .sort()
  .reverse();
for (const stale of keep.slice(3)) removeWithSideFiles(join(dir, stale));

if (method === "檔案複製")
  console.warn("[demo] ⚠ 找不到 sqlite3 CLI，改用檔案複製（非一致性快照；建議在 dev server 閒置時執行）");
console.log(`[demo] snapshot saved（方法：${method}）: prisma/demo-snapshots/demo.db、demo-${stamp}.db`);
