import { test, expect } from "@playwright/test";
import { resetDemo, shotPath } from "./helpers";

// 每次測試前重置 demo 資料，確保流程可重現
test.beforeAll(() => {
  resetDemo();
});

test("組隊局：隊長出發 → 隊伍提案 → 加入 → 團隊聊天", async ({ page }) => {
  // 1. Landing
  await page.goto("/");
  await expect(page.getByText(/你負責寫 Code/)).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shotPath("10-hack-landing.png"), fullPage: true });

  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  await expect(page.getByRole("button", { name: /隊長出發/ })).toBeVisible();

  // 2. 隊長出發 → 對談
  await page.getByRole("button", { name: /隊長出發/ }).click();
  await expect(page.getByText(/對談進行中/).first()).toBeVisible({
    timeout: 15_000,
  });
  // 所有對談完成後，「產生隊伍提案」才會出現
  await expect(
    page.getByRole("button", { name: /產生隊伍提案/ }),
  ).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: shotPath("11-hack-runs.png"), fullPage: true });

  // 2b. 破冰雷達：生成破冰卡
  await page.goto("/people");
  await expect(page.getByRole("heading", { name: /最該先聊的人/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成破冰卡" }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "生成破冰卡" }).first().click();
  await expect(page.getByText("開場三句（點一下複製）")).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shotPath("14-radar.png"), fullPage: true });

  // 2c. 匯出分享卡（PNG 下載）
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出分享卡" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("siebo-card");
  await download.saveAs(shotPath("16-share-card.png"));

  // 2d. GitHub 技能驗證
  await page.goto("/profile");
  await page
    .getByPlaceholder(/GitHub 使用者名稱/)
    .fill("afly-demo");
  const verified = page.waitForResponse(
    (r) => r.url().endsWith("/api/profile/verify/github") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "驗證" }).click();
  const vres = await verified;
  expect(vres.status(), await vres.text()).toBe(200);
  const vbody = (await vres.json()) as {
    verification: { username: string; source: string; publicRepos: number };
    ownershipVerified: boolean;
  };
  expect(vbody.verification.username).toBe("afly-demo");
  expect(vbody.verification.source).toBe("mock"); // 測試環境 GITHUB_VERIFY=mock，不打 GitHub
  expect(vbody.ownershipVerified).toBe(false); // 只比對公開資料，不證明帳號所有權
  await expect(page.getByText(/@afly-demo/).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shotPath("15-verify.png"), fullPage: true });

  // 2e. 匯出選手數據卡（自我介紹用）
  const cardPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出選手卡" }).click();
  const cardDl = await cardPromise;
  expect(cardDl.suggestedFilename()).toContain("siebo-player");
  await cardDl.saveAs(shotPath("17-player-card.png"));

  // 3. 產生隊伍提案（回指揮台）
  await page.goto("/agent");
  await expect(
    page.getByRole("button", { name: /產生隊伍提案/ }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /產生隊伍提案/ }).click();
  await page.waitForURL("**/teams");
  await expect(page.getByText("候選隊伍").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: shotPath("12-teams.png"), fullPage: true });

  // 4. 加入第一隊
  await page.getByRole("button", { name: "加入這隊" }).first().click();
  await expect(page.getByText("已成立的隊伍")).toBeVisible({ timeout: 15_000 });

  // 5. 進入團隊聊天室並發話 → 模擬隊友回覆
  await page.locator('a[href^="/team/"]').first().click();
  await page.waitForURL("**/team/**");
  await page.getByPlaceholder(/跟隊友討論分工/).fill(
    "嗨大家！我先把 repo 開好，前端我來，後端跟設計誰要先動？",
  );
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.locator("[data-msg]")).toHaveCount(2, { timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: shotPath("13-team-chat.png"), fullPage: true });
});
