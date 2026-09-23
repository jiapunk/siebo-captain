import { test, expect, type APIResponse } from "@playwright/test";
import { shotPath } from "./helpers";

/**
 * P3：EvoMap GEP-A2A 對接（opt-in）
 * 預設關閉、fail-open，不影響主要流程；指揮台顯示連線狀態。
 * 管理動作（POST）只限 EVOMAP_ADMIN_USER_IDS 裡的真帳號（測試環境清單為空 → 沒有人）：
 * 身分檢查排在 enabled 檢查之前，所以匿名、示範身分、一般真帳號都是 403 forbidden，
 * 不會因為 EvoMap 未啟用而先回 409（那樣就驗不到認證順序）。
 */

async function expectForbidden(res: APIResponse, who: string) {
  expect(res.status(), `${who} POST /api/evomap`).toBe(403);
  const body = (await res.json()) as { ok: boolean; error: string };
  expect(body, who).toMatchObject({ ok: false, error: "forbidden" });
}

test("EvoMap 預設 opt-out：狀態可查、動作限管理者、UI 標示 OFF", async ({ page }) => {
  // 1. 狀態端點：預設未啟用（公開可查、不含秘密）
  const res = await page.request.get("/api/evomap");
  expect(res.ok()).toBeTruthy();
  const raw = await res.text();
  const body = JSON.parse(raw) as { enabled: boolean; linked: boolean };
  expect(body.enabled).toBe(false);
  expect(body.linked).toBe(false);
  expect(raw).not.toMatch(/secret/i);

  // 2. 匿名：恰為 403 forbidden（不接受 409，確保身分檢查在 enabled 之前）
  await expectForbidden(
    await page.request.post("/api/evomap", { data: { action: "publish" } }),
    "匿名",
  );

  // 3. 示範身分（公開、任何人都能切換）：一樣 403，不能拿團隊節點去發佈
  await page.goto("/");
  await page.getByRole("button", { name: /Demo阿飛/ }).click();
  await page.waitForURL("**/agent");
  for (const action of ["publish", "validate", "fetch"]) {
    await expectForbidden(
      await page.request.post("/api/evomap", { data: { action } }),
      `示範身分 ${action}`,
    );
  }

  // 4. 指揮台狀態列
  await expect(page.getByText(/EVOMAP \/\//).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/OFF（opt-in/)).toBeVisible();
  await page.screenshot({ path: shotPath("20-evomap-off.png"), fullPage: true });
});

test("EvoMap：一般真帳號（不在管理者清單）也是 403", async ({ request }) => {
  const email = `evomap-${Date.now().toString(36)}@example.com`;
  const reg = await request.post("/api/auth/register", {
    data: { email, password: "strong-pass-123", name: "EvoUser" },
  });
  expect(reg.status(), await reg.text()).toBe(200);
  const me = await request.get("/api/me").then((r) => r.json());
  expect(me.authMode).toBe("session");

  await expectForbidden(
    await request.post("/api/evomap", { data: { action: "publish" } }),
    "一般真帳號",
  );

  // 清掉測試帳號
  expect((await request.delete("/api/me")).status()).toBe(200);
});
