import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { isDevDbUrl, sqlitePathFromUrl } from "../prisma/db-path";

/**
 * Playwright globalSetup：把測試專用 DB（playwright.config.ts 設的 prisma/test-<port>.db）
 * 建到最新 schema 並灌入種子。
 *
 * 注意 Playwright 會先啟動 webServer 再跑 globalSetup，所以這裡不刪檔（dev server 可能已開著連線），
 * 而是 migrate deploy（冪等）→ reset-demo（清掉上一輪測試產生的資料）→ seed（重建種子使用者與活動）。
 */
export default function globalSetup() {
  const url = process.env.DATABASE_URL ?? "";
  const dbPath = sqlitePathFromUrl(url);
  if (!dbPath || isDevDbUrl(url)) {
    throw new Error(
      `[e2e] DATABASE_URL 必須指向獨立的測試 SQLite（目前：${url || "未設定"}），拒絕在 demo 用的 prisma/dev.db 上跑測試`,
    );
  }
  const root = resolve(__dirname, "..");
  const run = (cmd: string) =>
    execSync(cmd, { cwd: root, env: process.env, stdio: ["ignore", "inherit", "inherit"] });

  console.log(`[e2e] 準備測試 DB：${dbPath}`);
  run("npx --no prisma migrate deploy");
  run("npx --no tsx prisma/reset-demo.ts");
  run("npx --no tsx prisma/seed.ts");
}
