import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";

// 每次測試前重置 demo 資料，確保流程可重現
test.beforeAll(() => {
  execSync("npx tsx prisma/reset-demo.ts", { cwd: process.cwd() });
});

/**
 * 單體 vs 蜂群對照（SECTION 9 賽道要求：質量/速度/成本取捨可量化）
 */

test("單體 vs 蜂群對照：跑一次單體 baseline 並顯示取捨表", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");

  // 先跑一輪蜂群（mock 模式 ~10s）
  await page.getByRole("button", { name: /隊長出發/ }).click();
  await expect(page.getByText(/對談進行中/).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("button", { name: /產生隊伍提案/ }),
  ).toBeVisible({ timeout: 60_000 });

  // 進入對照頁
  await page.goto("/compare");
  await expect(page.getByText("單體 vs 蜂群對照")).toBeVisible();
  await expect(page.getByText("蜂群").first()).toBeVisible({ timeout: 10_000 });

  // 執行單體 baseline
  await page.getByRole("button", { name: /執行單體對照/ }).click();
  await expect(page.getByText("取捨對照表")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("牆鐘延遲")).toBeVisible();
  await expect(page.getByText("報告欄位完整度")).toBeVisible();
  await expect(page.getByText(/兩者一致性：分數差/)).toBeVisible();
  await expect(page.getByText("五維對照")).toBeVisible();

  // 兩側卡片都有分數
  const cards = page.locator(".card.cut");
  await expect(cards.filter({ hasText: "蜂群" }).first()).toBeVisible();
  await expect(cards.filter({ hasText: "單體" }).first()).toBeVisible();

  await page.screenshot({ path: "shots/24-compare-solo-vs-swarm.png", fullPage: true });
});
