import { test, expect } from "@playwright/test";
import { resetDemo, shotPath } from "./helpers";

test.beforeAll(() => {
  resetDemo();
});

test("動態內容多語系：EN 模式下隊長對談與報告為英文", async ({ page }) => {
  // 切到英文
  await page.goto("/");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByText(/You write the code,/)).toBeVisible();

  // 以 Demo阿飛 出擊
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  await page.getByRole("button", { name: /Deploy Captain/ }).click();
  await expect(page.getByText(/LINK ACTIVE/).first()).toBeVisible({
    timeout: 15_000,
  });

  // 等對談完成後展開第一則，確認逐字稿與報告是英文（內容包生成）
  await expect(
    page.getByRole("button", { name: /Form squads/ }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Link established with/).first()).toBeVisible({
    timeout: 10_000,
  });
  // 內容包生成的英文逐字稿（mock 的 Q/A 模板）
  await expect(page.getByText(/main stack:/).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/Goal: |availability:/).first()).toBeVisible({
    timeout: 10_000,
  });
  await page.screenshot({ path: shotPath("27-en-dynamic.png"), fullPage: true });
});
