import { test, expect } from "@playwright/test";
import { resetDemo, shotPath } from "./helpers";

test.beforeAll(() => {
  resetDemo();
});

interface SimResult {
  edges: number;
  addedEdges: number;
  clustering: number;
  crossGroup: number;
  picked: [string, string][];
}

/** 聚類係數：0–1 的有限數值 */
function expectUnitInterval(v: unknown, label: string) {
  expect(typeof v, label).toBe("number");
  expect(Number.isFinite(v as number), label).toBe(true);
  expect(v as number, label).toBeGreaterThanOrEqual(0);
  expect(v as number, label).toBeLessThanOrEqual(1);
}

/** P2：Agent Ledger 記帳 + 合作網絡圖 + 兩種信號模擬 */
test("帳本記帳 → 網絡圖 → 社交/能力信號對照", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  await page.getByRole("button", { name: /隊長出發/ }).click();
  await expect(page.getByRole("button", { name: /產生隊伍提案/ })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /產生隊伍提案/ }).click();
  await page.waitForURL("**/teams");

  // 加入隊伍前：還沒有任何已成立的隊伍 → 沒有邊、聚類為 0
  const before = await page.request.get("/api/network").then((r) => r.json());
  expect(before.metrics.edges).toBe(0);
  expect(before.metrics.clustering).toBe(0);

  // 加入隊伍 + 團隊訊息 → 觸發 ledger 記帳
  await page.getByRole("button", { name: "加入這隊" }).first().click();
  await expect(page.getByText("已成立的隊伍")).toBeVisible({ timeout: 15_000 });
  await page.locator('a[href^="/team/"]').first().click();
  await page.waitForURL("**/team/**");
  await page.getByPlaceholder("跟隊友討論分工…").fill("我先把 repo 開好");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.locator("[data-msg]")).toHaveCount(2, { timeout: 20_000 });

  // 網絡 API：只有一支已成立的三人隊（沒有持續聯絡）→ 恰好 3 條邊、一個三角形
  const net = await page.request.get("/api/network").then((r) => r.json());
  expect(typeof net.eventId).toBe("string");
  const me = net.nodes.find((n: { name: string }) => n.name === "Demo阿飛");
  expect(me, "網絡節點裡找不到 Demo阿飛").toBeTruthy();
  expect(net.metrics.edges).toBe(3);
  expect(me.degree).toBe(2);
  expect(net.nodes.filter((n: { degree: number }) => n.degree === 2)).toHaveLength(3);
  // 標準平均聚類：三角形 3 個節點各 1，其餘節點 0 → 3 / 節點數，必須 >0 且 ≤1
  expectUnitInterval(net.metrics.clustering, "metrics.clustering");
  expect(net.metrics.clustering).toBeGreaterThan(0);
  expect(net.metrics.clustering).toBe(Math.round((3 / net.nodes.length) * 100) / 100);

  // 兩種信號模擬：有三人隊假設時，選出的隊伍（三角形）讓聚類 >0；隊友互不重疊
  expect(net.sim).not.toBeNull();
  expect(net.sim.hypotheses).toBeGreaterThanOrEqual(2);
  for (const mode of ["social", "competence"] as const) {
    const sim = net.sim[mode] as SimResult;
    expectUnitInterval(sim.clustering, `sim.${mode}.clustering`);
    expect(sim.picked.length, `sim.${mode}.picked`).toBeGreaterThanOrEqual(1);
    expect(sim.clustering, `sim.${mode}.clustering`).toBeGreaterThan(0);
    expect(sim.edges).toBeGreaterThanOrEqual(net.metrics.edges);
    const mates = sim.picked.flat();
    expect(new Set(mates).size, `sim.${mode} 隊友重疊`).toBe(mates.length);
  }

  // Ledger：加入隊伍（+8 起跳）＋ 1 則訊息 → 能力分至少 35 + 8 = 43
  expect(me.competence).toBeGreaterThanOrEqual(43);

  // UI
  await page.goto("/teams");
  await expect(page.getByText(/CLUSTERING/).first()).toBeVisible();
  await expect(page.getByText(/SIGNAL SIMULATION/)).toBeVisible();
  await expect(page.getByText(/\(SOCIAL\)/)).toBeVisible();
  await expect(page.getByText(/\(COMPETENCE\)/)).toBeVisible();
  await page.screenshot({ path: shotPath("18-network.png"), fullPage: true });
});
