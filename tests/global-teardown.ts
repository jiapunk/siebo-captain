import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Playwright globalTeardown：還原 next dev 對 tsconfig.json 的自動改寫。
 *
 * E2E 用獨立 distDir（NEXT_DIST_DIR=.next-test-<port>），next dev 啟動時會把
 * `.next-test-<port>/types/**` 與 `.next-test-<port>/dev/types/**` 加進 tsconfig.json 的 include，
 * 跑完測試工作區就多一個不該提交的改動。這裡只移除測試 distDir 的那兩行，其他設定原樣保留。
 */
export default function globalTeardown() {
  const distDir = process.env.NEXT_DIST_DIR ?? "";
  if (!distDir.startsWith(".next-test-")) return;

  const path = resolve(__dirname, "..", "tsconfig.json");
  let raw: string;
  let config: { include?: unknown };
  try {
    raw = readFileSync(path, "utf8");
    config = JSON.parse(raw);
  } catch {
    // 不是純 JSON（例如有人加了註解）就不動，避免誤改
    return;
  }
  if (!Array.isArray(config.include)) return;

  const prefix = `${distDir}/`;
  const include = config.include.filter(
    (entry) => !(typeof entry === "string" && entry.startsWith(prefix)),
  );
  if (include.length === config.include.length) return;

  config.include = include;
  // 與 Next 寫回時相同的格式：2 空白縮排、結尾換行
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}
