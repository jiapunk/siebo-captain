import { test, expect } from "@playwright/test";

test("多語系：繁中預設 → EN → 简中 → 日本語，重載後保留", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/你負責寫 Code/)).toBeVisible();

  // EN
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByText(/You write the code,/)).toBeVisible();
  await expect(page.getByText(/MISSION BRIEF/)).toBeVisible();

  // 简中（Simplified Chinese）
  await page.getByRole("button", { name: "简中", exact: true }).click();
  await expect(page.getByText(/你负责写 Code/)).toBeVisible();
  await expect(page.getByText(/建立选手文件/)).toBeVisible();

  // 日本語
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  await expect(page.getByText(/コードは君が書く。/)).toBeVisible();

  // reload 後保留（cookie）
  await page.reload();
  await expect(page.getByText(/コードは君が書く。/)).toBeVisible();

  // 切回繁中
  await page.getByRole("button", { name: "繁中", exact: true }).click();
  await expect(page.getByText(/你負責寫 Code/)).toBeVisible();
});
