import { test, expect } from "@playwright/test";
import { resetDemo } from "./helpers";

test.beforeAll(() => {
  resetDemo();
});

test("持續聯絡：破冰卡保持聯絡 → 隊伍頁清單 → 一對一私訊", async ({ page }) => {
  // 準備：完成一輪互盤
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  await page.getByRole("button", { name: /隊長出發/ }).click();
  await expect(
    page.getByRole("button", { name: /產生隊伍提案/ }),
  ).toBeVisible({ timeout: 60_000 });

  // 破冰卡 → 保持聯絡
  await page.goto("/people");
  await page.getByRole("button", { name: "生成破冰卡" }).first().click();
  await expect(page.getByText("開場三句（點一下複製）")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "保持聯絡" }).first().click();
  await expect(page.getByText("已建立聯絡 ✓").first()).toBeVisible({
    timeout: 15_000,
  });

  // 隊伍頁 → 持續聯絡區 → 進聊天
  await page.goto("/teams");
  await expect(page.getByText("持續聯絡").first()).toBeVisible();
  await page.locator('a[href^="/connect/"]').first().click();
  await page.waitForURL("**/connect/**");
  await page.getByPlaceholder("想聊什麼都可以…").fill("嗨！之後有專案可以一起做");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.locator("[data-msg]")).toHaveCount(2, { timeout: 20_000 });
});
