// 全新 clone 沒有 .env 時，從 .env.example 複製一份（預設全是安全值：mock、EvoMap 關閉、金鑰空白）
//   node scripts/ensure-env.mjs      （npm run setup 的第一步）
// 已經有 .env 就不動它。
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, ".env");
const examplePath = join(root, ".env.example");

if (existsSync(envPath)) {
  console.log("[setup] .env 已存在，保留原設定");
} else if (!existsSync(examplePath)) {
  console.error("[setup] 找不到 .env.example，無法建立 .env");
  process.exit(1);
} else {
  copyFileSync(examplePath, envPath);
  console.log("[setup] 已從 .env.example 建立 .env（mock 模式、EvoMap 關閉、金鑰空白）");
  console.log("[setup] 要接真 LLM / Jev：編輯 .env 的 LLM_PROVIDER、LLM_API_KEY、JEV_API_KEY");
}
