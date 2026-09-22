import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";

test.beforeAll(() => {
  execSync("npx tsx prisma/reset-demo.ts", { cwd: process.cwd() });
});

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

test("行動裝置：底部 Dock 導覽與單欄佈局", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/你負責寫 Code/)).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/20-mobile-landing.png", fullPage: false });

  // 以 Demo阿飛 進入 → 底部 Dock 出現
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  const dock = page.locator("nav.fixed");
  await expect(dock).toBeVisible();
  await expect(dock.getByText("破冰雷達")).toBeVisible();
  await expect(dock.getByText("隊伍")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/21-mobile-agent.png", fullPage: false });

  // Dock 導覽可用
  await dock.getByText("破冰雷達").click();
  await page.waitForURL("**/people");
  await expect(page.getByText(/最該先聊的人/)).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/22-mobile-radar.png", fullPage: false });
});
