import { test, expect } from "@playwright/test";
import { resetDemo } from "./helpers";

test.beforeAll(() => {
  resetDemo();
});

test("真帳號：註冊 → 加入場次 → 登出 → 登入", async ({ page }) => {
  // 1. 註冊
  await page.goto("/login");
  await page.getByRole("button", { name: /還沒有帳號/ }).click();
  await page.getByPlaceholder("怎麼稱呼你").fill("測試員");
  await page.getByPlaceholder("you@example.com").fill("tester@example.com");
  await page.getByPlaceholder("至少 8 個字元").fill("strong-pass-123");
  await page.getByRole("button", { name: /註冊並開始訪談/ }).click();
  await page.waitForURL("**/onboarding");

  // 身分來自 session
  const me = await page.request.get("/api/me").then((r) => r.json());
  expect(me.user?.email).toBe("tester@example.com");
  expect(me.authMode).toBe("session");

  // 2. 用活動 code 加入場次（新帳號預設不在任何場次；code 動態讀取）
  const current = await page.request
    .get("/api/events/current")
    .then((r) => r.json());
  const eventCode = current.event.code as string;
  const join = await page.request.post("/api/events/join", {
    data: { code: eventCode },
  });
  expect(join.ok()).toBeTruthy();
  const bad = await page.request.post("/api/events/join", {
    data: { code: "NO-SUCH-EVENT" },
  });
  expect(bad.status()).toBe(404);

  // 3. 登出
  await page.goto("/agent");
  await page.getByRole("button", { name: /測試員/ }).click();
  await page.getByRole("button", { name: "登出" }).click();
  await page.waitForURL("**/");
  await expect
    .poll(async () => (await page.request.get("/api/me").then((r) => r.json())).user)
    .toBeNull();
  // 登出後受保護 API 立刻拒絕
  expect((await page.request.get("/api/profile")).status()).toBe(401);

  // 4. 重新登入
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill("tester@example.com");
  await page.getByPlaceholder("你的密碼").fill("strong-pass-123");
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL("**/agent");
  const meAgain = await page.request.get("/api/me").then((r) => r.json());
  expect(meAgain.user?.email).toBe("tester@example.com");

  // 5. 錯誤密碼
  await page.request.post("/api/auth/logout");
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill("tester@example.com");
  await page.getByPlaceholder("你的密碼").fill("wrong-password-1");
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByText("Email 或密碼不正確。")).toBeVisible();
});

/**
 * 認證閘門（AUDIT §6「未登录 API 401 / 页面重定向」的實際證據）：
 * 沒有任何身分時，受保護 API 一律 401 {error:"unauthorized"}；需要身分的頁面在前端導回首頁。
 */
test("未登入：受保護 API 回 401，需要身分的頁面導回首頁", async ({ page }) => {
  const req = page.request;
  // 公開端點：未登入仍可讀，但不帶任何使用者資料
  const me = await req.get("/api/me");
  expect(me.status()).toBe(200);
  expect((await me.json()).user).toBeNull();

  const guardedGets = [
    "/api/people",
    "/api/teams",
    "/api/agent/runs",
    "/api/network",
    "/api/profile",
    "/api/connections",
  ];
  for (const path of guardedGets) {
    const r = await req.get(path);
    expect(r.status(), `GET ${path}`).toBe(401);
    expect((await r.json()).error, `GET ${path}`).toBe("unauthorized");
  }
  const guardedPosts: [string, unknown][] = [
    ["/api/matching/run", {}],
    ["/api/teams/assemble", {}],
    ["/api/onboarding/message", { content: "hi" }],
    ["/api/events/join", { code: "EVOTAVERN" }],
    ["/api/connections", { userId: "seed-anyone" }],
  ];
  for (const [path, data] of guardedPosts) {
    const r = await req.post(path, { data });
    expect(r.status(), `POST ${path}`).toBe(401);
    expect((await r.json()).error, `POST ${path}`).toBe("unauthorized");
  }

  // 頁面：前端確認沒有身分後導回首頁（不會停在空白頁或露出他人資料）
  for (const path of [
    "/agent",
    "/people",
    "/teams",
    "/compare",
    "/profile",
    "/onboarding",
    "/team/nope",
    "/connect/nope",
  ]) {
    await page.goto(path);
    await page.waitForURL((u) => u.pathname === "/", { timeout: 15_000 });
  }
  await expect(page.getByRole("button", { name: /Demo阿飛/ })).toBeVisible();
});
