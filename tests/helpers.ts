import { join } from "node:path";

/** 測試截圖／下載檔的統一輸出目錄（已被 .gitignore 的 test-results/ 涵蓋，不會弄髒 repo） */
export const SHOTS_DIR = join("test-results", "shots");

/**
 * 截圖路徑：shotPath("10-hack-landing.png") → "test-results/shots/10-hack-landing.png"
 * 用法：await page.screenshot({ path: shotPath("10-hack-landing.png") })
 */
export function shotPath(name: string): string {
  return join(SHOTS_DIR, name);
}
