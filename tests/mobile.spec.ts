import { test, expect, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, resetDemo, shotPath } from "./helpers";

test.beforeAll(() => {
  resetDemo();
});

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

/** 390px 下桌面導覽隱藏，唯一可見、含 /people 連結的 navigation 就是底部 Dock（用路由選，不依賴文案） */
function dockOf(page: Page) {
  return page
    .getByRole("navigation")
    .filter({ has: page.locator('a[href="/people"]') })
    .filter({ visible: true });
}

test("行動裝置：底部 Dock 單列導覽、各頁無水平捲動", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/你負責寫 Code/)).toBeVisible();
  await expectNoHorizontalScroll(page, "/");
  await page.screenshot({ path: shotPath("20-mobile-landing.png"), fullPage: false });

  // 以 Demo阿飛 進入 → 底部 Dock 出現
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  const dock = dockOf(page);
  await expect(dock).toHaveCount(1);
  await expect(dock).toBeVisible();
  const radar = dock.locator('a[href="/people"]');
  await expect(radar).toContainText(/雷達/);
  await expect(dock.locator('a[href="/teams"]')).toContainText(/隊/);

  // Dock 單列：每個導覽項目同一條基線，整條 Dock 只有一列高，且貼齊視窗底部
  const links = dock.getByRole("link");
  const n = await links.count();
  expect(n).toBeGreaterThanOrEqual(4);
  // 每個項目都有真的標籤（不是空字串，也不是沒翻到的 i18n key）
  for (const label of await links.allInnerTexts()) {
    expect(label.trim().length, "Dock 項目沒有標籤").toBeGreaterThan(0);
    expect(label, "Dock 標籤是未翻譯的 i18n key").not.toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/m);
  }
  const boxes = await Promise.all(
    Array.from({ length: n }, (_, i) => links.nth(i).boundingBox()),
  );
  const tops = boxes.map((b) => Math.round(b!.y));
  expect(Math.max(...tops) - Math.min(...tops), `Dock 項目換行：top=${tops}`).toBeLessThanOrEqual(1);
  const lefts = boxes.map((b) => b!.x);
  expect(new Set(lefts.map((x) => Math.round(x))).size, "Dock 項目橫向重疊").toBe(n);
  for (const b of boxes) {
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.width).toBeLessThanOrEqual(390 + 0.5);
  }
  const dockBox = (await dock.boundingBox())!;
  const rowHeight = Math.max(...boxes.map((b) => b!.height));
  expect(dockBox.height, `Dock 高 ${dockBox.height}px，超過一列（${rowHeight}px）`).toBeLessThan(
    rowHeight * 1.5,
  );
  expect(Math.round(dockBox.y + dockBox.height)).toBe(844);
  await expectNoHorizontalScroll(page, "/agent");
  await page.screenshot({ path: shotPath("21-mobile-agent.png"), fullPage: false });

  // Dock 導覽可用：逐頁檢查沒有水平捲動
  await radar.click();
  await page.waitForURL("**/people");
  await expect(page.getByText(/最該先聊的人/)).toBeVisible();
  await expectNoHorizontalScroll(page, "/people");
  await page.screenshot({ path: shotPath("22-mobile-radar.png"), fullPage: false });

  for (const path of ["/teams", "/compare", "/profile"]) {
    await dock.locator(`a[href="${path}"]`).click();
    await page.waitForURL(`**${path}`);
    await expect(page.locator("main").first()).toBeVisible();
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 10_000 });
    await expectNoHorizontalScroll(page, path);
  }
});
