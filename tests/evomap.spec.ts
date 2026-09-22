import { test, expect } from "@playwright/test";

/**
 * P3：EvoMap GEP-A2A 對接（opt-in）
 * 預設關閉、fail-open，不影響主要流程；指揮台顯示連線狀態。
 */

test("EvoMap 預設 opt-out：狀態可查、動作被拒、UI 標示 OFF", async ({ page }) => {
  // 1. 狀態端點：預設未啟用（公開可查）
  const res = await page.request.get("/api/evomap");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { enabled: boolean; linked: boolean };
  expect(body.enabled).toBe(false);
  expect(body.linked).toBe(false);

  // 2. 未登入時動作需授權
  const anon = await page.request.post("/api/evomap", {
    data: { action: "publish" },
  });
  expect([401, 409]).toContain(anon.status());

  // 3. 登入後：未啟用 → 明確拒絕（fail-open，不擲錯）
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  const pub = await page.request.post("/api/evomap", {
    data: { action: "publish" },
  });
  expect(pub.status()).toBe(409);
  const pb = (await pub.json()) as { ok: boolean; error: string };
  expect(pb.ok).toBe(false);
  expect(pb.error).toBe("evomap_disabled");

  // 4. 指揮台狀態列
  await expect(page.getByText(/EVOMAP \/\//).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/OFF（opt-in/)).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/20-evomap-off.png", fullPage: true });
});
