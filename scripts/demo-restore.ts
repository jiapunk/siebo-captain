import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 還原 demo 快照
 *   npm run demo:restore
 * 會先移除 dev.db 的 -journal / -wal / -shm（避免舊交易日誌污染），再整檔覆寫。
 * 還原後自動跑 db:rebaseline（舊快照可能還記著舊的 migration 歷史）與 db:prune-orphans
 * （清掉舊版 reset 留下、沒有 FK 擋住的孤兒 SwarmPart），最後請重啟 server。
 */
const prismaDir = join(process.cwd(), "prisma");
const snap = join(prismaDir, "demo-snapshots/demo.db");
if (!existsSync(snap)) {
  console.log("[demo] 沒有快照可還原（prisma/demo-snapshots/demo.db 不存在；快照不進版控，全新 clone 本來就沒有）");
  console.log("[demo] 要回到初始 demo 資料：npm run db:seed；要先留快照：npm run demo:snapshot");
  process.exit(0);
}
const dst = join(prismaDir, "dev.db");
for (const suffix of ["-journal", "-wal", "-shm"]) {
  if (existsSync(`${dst}${suffix}`)) rmSync(`${dst}${suffix}`);
}
// 原地覆寫（保留同一個檔案 inode），執行中的 server 不會繼續讀到被刪掉的舊檔
copyFileSync(snap, dst);
console.log("[demo] restored → prisma/dev.db");

// 舊快照的 _prisma_migrations 可能是舊的 10 筆歷史：對齊 baseline（schema 不一致時只警告，不改寫）
const r = spawnSync("npx", ["--no", "tsx", join(__dirname, "db-rebaseline.ts")], {
  cwd: resolve(__dirname, ".."),
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: `file:${dst}` },
});
if (r.status !== 0)
  console.warn("[demo] ⚠ migration 紀錄未對齊（見上方訊息）；資料已還原，但之後 prisma migrate deploy 可能失敗");

// 舊快照可能帶著舊版 reset 留下的孤兒 SwarmPart（沒有 FK）：還原後一併清掉（規則見 prisma/orphans.ts）
const p = spawnSync("npx", ["--no", "tsx", join(__dirname, "db-prune-orphans.ts"), "--allow-dev-db"], {
  cwd: resolve(__dirname, ".."),
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: `file:${dst}` },
});
if (p.status !== 0) console.warn("[demo] ⚠ 孤兒資料清理失敗（見上方訊息）；資料已還原，畫面不受影響");

console.log("[demo] ⚠ 請重啟 server（npm run dev 或 npm run demo:serve），確保連線讀到還原後的資料");
