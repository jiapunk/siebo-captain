import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";

test.beforeAll(() => {
  execSync("npx tsx prisma/reset-demo.ts", { cwd: process.cwd() });
});

/** P2：Agent Ledger 記帳 + 合作網絡圖 + 兩種信號模擬 */
test("帳本記帳 → 網絡圖 → 社交/能力信號對照", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  await page.getByRole("button", { name: /隊長出發/ }).click();
  await expect(
    page.getByRole("button", { name: /產生隊伍提案/ }),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /產生隊伍提案/ }).click();
  await page.waitForURL("**/teams");

  // 加入隊伍 + 團隊訊息 → 觸發 ledger 記帳
  await page.getByRole("button", { name: "加入這隊" }).first().click();
  await expect(page.getByText("已成立的隊伍")).toBeVisible({ timeout: 15_000 });
  await page.locator('a[href^="/team/"]').first().click();
  await page.waitForURL("**/team/**");
  await page.getByPlaceholder("跟隊友討論分工…").fill("我先把 repo 開好");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.locator("[data-msg]")).toHaveCount(2, { timeout: 20_000 });

  // 網絡 API：節點、邊、聚類、模擬
  const net = await page.request.get("/api/network").then((r) => r.json());
  expect(net.nodes.length).toBeGreaterThanOrEqual(3);
  expect(typeof net.metrics.clustering).toBe("number");
  expect(net.metrics.edges).toBeGreaterThanOrEqual(2); // 三人隊 = 3 條邊
  expect(net.sim).not.toBeNull();
  expect(net.sim.hypotheses).toBeGreaterThanOrEqual(2);
  expect(typeof net.sim.social.clustering).toBe("number");
  expect(typeof net.sim.competence.clustering).toBe("number");

  // Ledger：加入隊伍後我的能力分應高於基準 35
  const meNode = net.nodes.find((n: { name: string }) => n.name === "Demo阿飛");
  expect(meNode.competence).toBeGreaterThan(35);

  // UI
  await page.goto("/teams");
  await expect(page.getByText(/CLUSTERING/).first()).toBeVisible();
  await expect(page.getByText(/SIGNAL SIMULATION/)).toBeVisible();
  await expect(page.getByText(/社交模式/)).toBeVisible();
  await expect(page.getByText(/能力模式/)).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/18-network.png", fullPage: true });
});
