import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * 還原 demo 快照
 *   npm run demo:restore
 * 會先移除 dev.db 的 WAL/SHM（避免舊交易日誌污染），再整檔覆寫。
 * 建議：還原後重啟 dev server 以取得最乾淨狀態。
 */
const prismaDir = join(process.cwd(), "prisma");
const snap = join(prismaDir, "demo-snapshots/demo.db");
if (!existsSync(snap)) {
  console.error("找不到快照 prisma/demo-snapshots/demo.db——先跑 npm run demo:snapshot");
  process.exit(1);
}
const dst = join(prismaDir, "dev.db");
for (const suffix of ["-wal", "-shm"]) {
  if (existsSync(`${dst}${suffix}`)) rmSync(`${dst}${suffix}`);
}
copyFileSync(snap, dst);
console.log("[demo] restored → prisma/dev.db（建議重啟 dev server）");
