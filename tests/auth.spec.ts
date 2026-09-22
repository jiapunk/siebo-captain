import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";

test.beforeAll(() => {
  execSync("npx tsx prisma/reset-demo.ts", { cwd: process.cwd() });
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
  await page.waitForTimeout(300);
  const afterLogout = await page.request.get("/api/me").then((r) => r.json());
  expect(afterLogout.user).toBeNull();

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
