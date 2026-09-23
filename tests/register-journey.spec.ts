import { test, expect, request as pwRequest } from "@playwright/test";
import { resetDemo } from "./helpers";

test.beforeAll(() => {
  resetDemo();
});

test.setTimeout(240_000);

const EMAIL = "journey@example.com";
const PW = "journey-pass-123";
const PW2 = "journey-pass-456";

test("註冊 → 驗證 → 訪談 → 組隊 → 聊天 → 重登 → 密碼重設", async ({ page, baseURL }) => {
  // ---------- 1. 註冊 ----------
  await page.goto("/login");
  const eventCode: string = await page.request
    .get("/api/events/current")
    .then((res) => res.json())
    .then((d) => d.event.code);
  await page.getByRole("button", { name: /還沒有帳號/ }).click();
  await page.getByPlaceholder("怎麼稱呼你").fill("旅程測試員");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("至少 8 個字元").fill(PW);
  await page.getByPlaceholder("例：EVOTAVERN").fill(eventCode);
  await page.getByRole("button", { name: /註冊並開始訪談/ }).click();
  await page.waitForURL("**/onboarding");

  const me1 = await page.request.get("/api/me").then((r) => r.json());
  expect(me1.user?.email).toBe(EMAIL);
  expect(me1.authMode).toBe("session");
  expect(me1.user?.emailVerified).toBe(false);
  expect(me1.user?.event?.code).toBe(eventCode);

  // ---------- 2. 未驗證閘門：配對應被擋 ----------
  const blocked = await page.request.post("/api/matching/run");
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).error).toBe("email_unverified");

  // ---------- 3. 完成 Email 驗證（dev 連結） ----------
  await expect(page.getByText(/Email 未驗證/)).toBeVisible();
  await page.getByRole("button", { name: "寄送驗證連結" }).click();
  const verifyLink = page.getByRole("link", { name: "開啟驗證連結" });
  await expect(verifyLink).toBeVisible({ timeout: 10_000 });
  await verifyLink.click();
  await page.waitForURL("**/verify?token=**");
  await expect(page.getByText("驗證成功 ✓")).toBeVisible({ timeout: 20_000 });
  const me2 = await page.request.get("/api/me").then((r) => r.json());
  expect(me2.user?.emailVerified).toBe(true);

  // ---------- 4. 隱私告知同意 → 六題訪談 → 編譯 ----------
  await page.goto("/onboarding");
  // 新訪談要先勾選同意才開始（未勾選時按鈕不可按）
  const start = page.getByRole("button", { name: /開始訪談/ });
  await expect(start).toBeDisabled();
  // 告知卡寫明保存期限：訪談原文編譯後刪除、活動結束 30 天後清除帳號
  await expect(page.getByText(/編譯完成就刪除.*活動結束 30 天後/)).toBeVisible();
  await page.getByRole("checkbox", { name: /同意/ }).check();
  await start.click();
  const answers = [
    "我寫 TypeScript 跟 React",
    "想拿獎，也學新東西",
    "全程 48 小時都在",
    "最怕報名後消失的人；我 cover 前端很快",
    "先畫架構再動手",
    "github.com/journey-demo",
  ];
  for (let i = 0; i < answers.length; i++) {
    const input = page.getByPlaceholder("像跟朋友聊天一樣回答…");
    if (i === 0) await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(answers[i]);
    // 等這一輪隊長回覆真的回來（而不是固定 sleep），下一輪才送
    const replied = page.waitForResponse(
      (r) => r.url().endsWith("/api/onboarding/message") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "送出" }).click();
    const res = await replied;
    expect(res.status(), `第 ${i + 1} 題：${await res.text()}`).toBe(200);
    const { reply, done } = (await res.json()) as { reply: string; done: boolean };
    await expect(page.getByText(reply, { exact: true }).last()).toBeVisible();
    expect(done).toBe(i === answers.length - 1);
  }
  const compileBtn = page.getByRole("button", { name: /完成訪談，編譯我的檔案/ });
  await expect(compileBtn).toBeVisible({ timeout: 15_000 });
  await compileBtn.click();
  await page.waitForURL("**/profile?compiled=1", { timeout: 20_000 });
  await expect(page.getByText(/已根據訪談編譯/)).toBeVisible();

  // ---------- 5. 出擊 → 破冰卡 → 保持聯絡 ----------
  await page.goto("/agent");
  await page.getByRole("button", { name: /隊長出發/ }).click();
  await expect(
    page.getByRole("button", { name: /產生隊伍提案/ }),
  ).toBeVisible({ timeout: 60_000 });

  await page.goto("/people");
  await page.getByRole("button", { name: "生成破冰卡" }).first().click();
  await expect(page.getByText(/開場三句/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "保持聯絡" }).first().click();
  await expect(page.getByText("已建立聯絡 ✓").first()).toBeVisible({
    timeout: 15_000,
  });

  // ---------- 6. 產生隊伍提案 → 加入 → 群聊 ----------
  await page.goto("/agent");
  await page.getByRole("button", { name: /產生隊伍提案/ }).click();
  await page.waitForURL("**/teams");
  const joined = page.waitForResponse(
    (r) => /^\/api\/teams\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "加入這隊" }).first().click();
  const jr = await joined;
  expect(jr.status(), await jr.text()).toBe(200);
  const teamId = new URL(jr.url()).pathname.split("/").pop()!;
  const { status, pending } = (await jr.json()) as { status: string; pending: string[] };
  if (status === "proposed") {
    // 隊裡還有其他真人（例如示範身分 Demo阿飛）：要每位真人都同意才成立
    expect(pending.length).toBeGreaterThan(0);
    await expect(page.getByText(/等待.*同意/).first()).toBeVisible({ timeout: 10_000 });
    for (const uid of pending) {
      const mate = await pwRequest.newContext({ baseURL });
      const sw = await mate.post("/api/session", { data: { userId: uid } });
      expect(sw.status(), `切換到隊友 ${uid}：${await sw.text()}`).toBe(200);
      const ok = await mate.post(`/api/teams/${teamId}`);
      expect(ok.status(), await ok.text()).toBe(200);
      await mate.dispose();
    }
    await page.reload();
  } else {
    expect(status).toBe("assembled");
  }
  await expect(page.getByText("已成立的隊伍")).toBeVisible({ timeout: 15_000 });
  await page.locator('a[href^="/team/"]').first().click();
  await page.waitForURL("**/team/**");
  await page.getByPlaceholder("跟隊友討論分工…").fill("前端我先開專案");
  await page.getByRole("button", { name: "送出" }).click();
  await expect(page.locator("[data-msg]")).toHaveCount(2, { timeout: 20_000 });

  // ---------- 7. 登出後重新登入 ----------
  await page.getByRole("button", { name: /旅程測試員/ }).click();
  await page.getByRole("button", { name: "登出" }).click();
  await page.waitForURL("**/");
  await page.goto("/login");
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("你的密碼").fill(PW);
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL("**/agent");
  const me3 = await page.request.get("/api/me").then((r) => r.json());
  expect(me3.user?.email).toBe(EMAIL);
  expect(me3.user?.emailVerified).toBe(true);

  // ---------- 8. 忘記密碼 → 重設 → 用新密碼登入 ----------
  await page.request.post("/api/auth/logout");
  await page.goto("/login");
  await page.getByRole("button", { name: "忘記密碼？" }).click();
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByRole("button", { name: "取得重設連結" }).click();
  const resetLink = page.getByRole("link", { name: "開啟重設連結" });
  await expect(resetLink).toBeVisible({ timeout: 10_000 });
  await resetLink.click();
  await page.waitForURL("**/reset?token=**");
  await page.getByPlaceholder("至少 8 個字元").first().fill(PW2);
  await page.getByPlaceholder("至少 8 個字元").nth(1).fill(PW2);
  await page.getByRole("button", { name: "重設密碼" }).click();
  await expect(page.getByText(/密碼已重設/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("link", { name: "前往登入" }).click();
  await page.waitForURL("**/login");

  // 舊密碼失效
  await page.getByPlaceholder("you@example.com").fill(EMAIL);
  await page.getByPlaceholder("你的密碼").fill(PW);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByText("Email 或密碼不正確。")).toBeVisible({
    timeout: 10_000,
  });
  // 新密碼成功
  await page.getByPlaceholder("你的密碼").fill(PW2);
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL("**/agent", { timeout: 15_000 });
});
