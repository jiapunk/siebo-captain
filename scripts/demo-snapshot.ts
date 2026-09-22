import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * demo 資料庫一致性快照（SQLite VACUUM INTO，含 WAL 內容）
 *   npm run demo:snapshot
 * 位置：prisma/demo-snapshots/demo.db（另存時間戳版本，保留最新 3 份）
 */
const prismaDir = join(process.cwd(), "prisma");
const src = join(prismaDir, "dev.db");
if (!existsSync(src)) {
  console.error("找不到 prisma/dev.db——先跑 npm run db:seed");
  process.exit(1);
}
const dir = join(prismaDir, "demo-snapshots");
mkdirSync(dir, { recursive: true });

function snapshotTo(dest: string) {
  const r = spawnSync("sqlite3", [src, `VACUUM INTO '${dest}'`], { encoding: "utf8" });
  if (r.status !== 0) {
    // 沒有 sqlite3 CLI 時退回檔案複製（含 -wal / -shm）
    console.warn("[demo] sqlite3 不可用，改用檔案複製");
    copyFileSync(src, dest);
    for (const suffix of ["-wal", "-shm"])
      if (existsSync(`${src}${suffix}`)) copyFileSync(`${src}${suffix}`, `${dest}${suffix}`);
  }
}

snapshotTo(join(dir, "demo.db"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
snapshotTo(join(dir, `demo-${stamp}.db`));

const keep = readdirSync(dir)
  .filter((f) => f.startsWith("demo-") && f.endsWith(".db"))
  .sort()
  .reverse();
for (const stale of keep.slice(3)) rmSync(join(dir, stale));
console.log(`[demo] snapshot saved（VACUUM INTO）: prisma/demo-snapshots/demo.db`);
