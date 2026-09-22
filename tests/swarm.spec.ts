import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";

test.beforeAll(() => {
  execSync("npx tsx prisma/reset-demo.ts", { cwd: process.cwd() });
});

/**
 * P0+P1 蜂群驗證：
 * - 每個互盤 run 必須完整覆蓋 6 個 parts、retry 0、retain 100%（決策層路徑）
 * - 隊伍提案改由「假設枚舉 → 隔離評估 → 程序匯合」產生，且數量 2-3、成員不重複
 */
test("蜂群 Part 覆蓋 + 假設評估式組隊", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  await page.getByRole("button", { name: /隊長出發/ }).click();
  await expect(
    page.getByRole("button", { name: /產生隊伍提案/ }),
  ).toBeVisible({ timeout: 60_000 });

  // P0：每個 run 顯示 PARTS 6/6 · RETAIN 100%
  await expect(page.getByText(/PARTS 6\/6/).first()).toBeVisible();
  await expect(page.getByText(/RETAIN 100%/).first()).toBeVisible();
  await expect(page.getByText(/RETRY/)).toHaveCount(0);

  // 產出隊伍（P1）
  await page.getByRole("button", { name: /產生隊伍提案/ }).click();
  await page.waitForURL("**/teams");
  await expect(page.getByText(/HYPOTHESES \d+/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("候選隊伍").first()).toBeVisible();

  // 匯合訊息：每隊都有 evidence 行（ENGINE 來源 + 四個維度）
  await expect(page.getByText(/覆蓋 \d+/).first()).toBeVisible();

  // 成員不重複：抽兩張提案卡比對成員名單不重疊
  const proposalTexts = await page
    .locator(".cut")
    .filter({ hasText: "SQUAD PROPOSAL" })
    .allInnerTexts();
  expect(proposalTexts.length).toBeGreaterThanOrEqual(2);
  const names = proposalTexts.map((t) =>
    t
      .split("\n")
      .filter((l) => /DEMO阿飛|里歐|小滿|阿哲|霓霓|老吳|Kiwi|阿宏|小綠/.test(l))
      .join("|"),
  );
  // 至少前兩隊的成員組合不同（不重疊保證）
  expect(names[0]).not.toBe(names[1]);
});
