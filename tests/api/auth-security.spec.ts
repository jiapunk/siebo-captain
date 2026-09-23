import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

/**
 * 身分與存取控制的負向 API 測試（只用 request，不開 UI）。
 * 守住：sd_uid 冒用、名冊外洩、登入/註冊節流、檔案欄位偽造、跨來源 POST、帳號刪除。
 * 每個測試用獨立的 APIRequestContext（各自的 cookie jar）與唯一 email，彼此不共用狀態。
 */

const PW = "strong-pass-123";

function uniq() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

let ctxs: APIRequestContext[] = [];

async function newCtx(
  baseURL: string | undefined,
  extraHTTPHeaders?: Record<string, string>,
) {
  const ctx = await pwRequest.newContext({ baseURL, extraHTTPHeaders });
  ctxs.push(ctx);
  return ctx;
}

test.afterEach(async () => {
  await Promise.all(ctxs.map((c) => c.dispose()));
  ctxs = [];
});

async function register(ctx: APIRequestContext, tag: string) {
  const email = `sec-${tag}-${uniq()}@example.com`;
  const res = await ctx.post("/api/auth/register", {
    data: { email, password: PW, name: `Sec-${tag}`.slice(0, 12) },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { id: string };
  return { id: body.id, email };
}

async function demoRoster(ctx: APIRequestContext) {
  const res = await ctx.get("/api/users");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { users: Array<Record<string, unknown>> }).users;
}

async function errorOf(res: APIResponse) {
  return ((await res.json()) as { error?: string }).error;
}

test("真帳號無法被 sd_uid 冒用（手動塞 cookie 也不行）", async ({ baseURL }) => {
  const victim = await newCtx(baseURL);
  const { id } = await register(victim, "victim");

  const attacker = await newCtx(baseURL, { Cookie: `sd_uid=${encodeURIComponent(id)}` });
  const me = await (await attacker.get("/api/me")).json();
  expect(me.user).toBeNull();
  expect((await attacker.get("/api/profile")).status()).toBe(401);
  expect((await attacker.post("/api/auth/resend-verify")).status()).toBe(401);

  // 不存在的 id 也不算登入
  const ghost = await newCtx(baseURL, { Cookie: "sd_uid=nonexistent-xyz" });
  expect((await (await ghost.get("/api/me")).json()).user).toBeNull();
});

test("/api/users 只列示範身分、不含真帳號與 email", async ({ baseURL }) => {
  const victim = await newCtx(baseURL);
  const { id } = await register(victim, "roster");

  const anon = await newCtx(baseURL);
  const users = await demoRoster(anon);
  expect(users.length).toBeGreaterThan(0);
  expect(users.map((u) => u.id)).not.toContain(id);
  for (const u of users) expect(u).not.toHaveProperty("email");
});

test("POST /api/session：真帳號 403、示範身分可切換、真 session 永遠優先", async ({
  baseURL,
}) => {
  const victim = await newCtx(baseURL);
  const { id: victimId } = await register(victim, "sess");

  const anon = await newCtx(baseURL);
  const denied = await anon.post("/api/session", { data: { userId: victimId } });
  expect(denied.status()).toBe(403);
  expect(await errorOf(denied)).toBe("not_demo_identity");
  expect((await (await anon.get("/api/me")).json()).user).toBeNull();

  const demo = (await demoRoster(anon))[0];
  const ok = await anon.post("/api/session", { data: { userId: demo.id } });
  expect(ok.status()).toBe(200);
  const setCookie = ok
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value)
    .join("\n");
  expect(setCookie).toMatch(/sd_uid=/);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=lax/i);
  expect(setCookie).toMatch(/Path=\//);
  const me = await (await anon.get("/api/me")).json();
  expect(me.authMode).toBe("demo");
  expect(me.user.id).toBe(demo.id);

  // 已登入真帳號時不能切換
  const busy = await victim.post("/api/session", { data: { userId: demo.id } });
  expect(busy.status()).toBe(409);
  expect(await errorOf(busy)).toBe("session_active");

  // 同時帶 sc_sid 與 sd_uid：以 session 為準
  const sid = (await victim.storageState()).cookies.find((c) => c.name === "sc_sid")?.value;
  expect(sid).toBeTruthy();
  const both = await newCtx(baseURL, {
    Cookie: `sc_sid=${sid}; sd_uid=${encodeURIComponent(String(demo.id))}`,
  });
  const meBoth = await (await both.get("/api/me")).json();
  expect(meBoth.authMode).toBe("session");
  expect(meBoth.user.id).toBe(victimId);
});

test("登入失敗 8 次後第 9 次得 429，換 X-Forwarded-For 也繞不過", async ({ baseURL }) => {
  const ctx = await newCtx(baseURL);
  const { email } = await register(ctx, "login");
  await ctx.post("/api/auth/logout");

  const login = await ctx.post("/api/auth/login", { data: { email, password: PW } });
  expect(login.status()).toBe(200);
  const setCookie = login
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value)
    .join("\n");
  expect(setCookie).toMatch(/sc_sid=[^;]+;/);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=lax/i);
  await ctx.post("/api/auth/logout");

  for (let i = 0; i < 8; i++) {
    const r = await ctx.post("/api/auth/login", {
      data: { email, password: `wrong-password-${i}` },
    });
    expect(r.status()).toBe(401);
  }
  const blocked = await ctx.post("/api/auth/login", {
    data: { email, password: "wrong-password-9" },
  });
  expect(blocked.status()).toBe(429);
  const body = await blocked.json();
  expect(body.error).toBe("too_many_attempts");
  expect(body.retryAfterSec).toBeGreaterThan(0);
  expect(blocked.headers()["retry-after"]).toBeTruthy();

  // 鎖定期間正確密碼也不行；偽造 XFF 換不到新的桶
  expect(
    (await ctx.post("/api/auth/login", { data: { email, password: PW } })).status(),
  ).toBe(429);
  expect(
    (
      await ctx.post("/api/auth/login", {
        data: { email, password: PW },
        headers: { "X-Forwarded-For": "203.0.113.7" },
      })
    ).status(),
  ).toBe(429);

  // 不存在的帳號回同樣的 401
  const ghost = await ctx.post("/api/auth/login", {
    data: { email: `nobody-${uniq()}@example.com`, password: PW },
  });
  expect(ghost.status()).toBe(401);
  expect(await errorOf(ghost)).toBe("invalid_credentials");
});

test("register 節流：同一 email 15 分鐘第 6 次得 429", async ({ baseURL }) => {
  const ctx = await newCtx(baseURL);
  const email = `sec-reg-${uniq()}@example.com`;
  const data = { email, password: PW, name: "Reg" };
  expect((await ctx.post("/api/auth/register", { data })).status()).toBe(200);
  for (let i = 0; i < 4; i++) {
    const r = await ctx.post("/api/auth/register", { data });
    expect(r.status()).toBe(409);
  }
  const blocked = await ctx.post("/api/auth/register", { data });
  expect(blocked.status()).toBe(429);
  expect(await errorOf(blocked)).toBe("too_many_attempts");
});

test("forgot：不存在的帳號回應與有帳號時同形狀，且不外洩連結", async ({ baseURL }) => {
  const ctx = await newCtx(baseURL);
  const { email } = await register(ctx, "forgot");
  const ghost = await ctx.post("/api/auth/forgot", {
    data: { email: `nobody-${uniq()}@example.com` },
  });
  expect(ghost.status()).toBe(200);
  expect(await ghost.json()).toEqual({ ok: true, devResetUrl: null });
  // 測試環境 AUTH_DEV_RESET_LINKS=on 且非 production，才會拿到連結
  const real = await ctx.post("/api/auth/forgot", { data: { email } });
  expect(real.status()).toBe(200);
  expect(Object.keys(await real.json()).sort()).toEqual(["devResetUrl", "ok"]);
});

test("PUT /api/profile：不能寫入 github、格式錯誤回 400", async ({ baseURL }) => {
  const ctx = await newCtx(baseURL);
  await register(ctx, "prof");

  const forged = {
    role: "前端",
    skills: ["React", "TypeScript"],
    bio: "hello",
    github: {
      username: "torvalds",
      source: "github-api",
      publicRepos: 999,
      topLanguages: [{ lang: "Rust", count: 99 }],
      matchedSkills: ["Rust"],
      note: "FORGED",
    },
  };
  const put = await ctx.put("/api/profile", { data: { compiled: forged } });
  expect(put.status()).toBe(200);
  const { profile } = await (await ctx.get("/api/profile")).json();
  expect(profile.compiled.role).toBe("前端");
  expect(profile.compiled.skills).toEqual(["React", "TypeScript"]);
  expect(profile.compiled).not.toHaveProperty("github");
  expect(profile.verification).toBeNull();

  const bad = [
    { compiled: { skills: "React" } },
    { compiled: { role: 42 } },
    { compiled: { bio: "x".repeat(5000) } },
    { compiled: { skills: Array.from({ length: 100 }, (_, i) => `s${i}`) } },
    { compiled: "nope" },
    { visibility: { role: "yes" } },
  ];
  for (const data of bad) {
    const r = await ctx.put("/api/profile", { data });
    expect(r.status(), JSON.stringify(data).slice(0, 80)).toBe(400);
    expect(await errorOf(r)).toBe("invalid_profile");
  }
  const notJson = await ctx.put("/api/profile", {
    data: "{not json",
    headers: { "Content-Type": "application/json" },
  });
  expect(notJson.status()).toBe(400);

  // 驗證結果只由伺服器寫入，並標註「不證明帳號所有權」
  const gh = await ctx.post("/api/profile/verify/github", {
    data: { username: "https://github.com/afly-demo/" },
  });
  expect(gh.status()).toBe(200);
  const ghBody = await gh.json();
  expect(ghBody.ownershipVerified).toBe(false);
  expect(ghBody.verification.username).toBe("afly-demo");
  expect(ghBody.verification.ownershipVerified).toBe(false);
  // PUT 不能蓋掉伺服器寫入的驗證結果
  await ctx.put("/api/profile", { data: { compiled: forged } });
  const after = (await (await ctx.get("/api/profile")).json()).profile;
  expect(after.verification.username).toBe("afly-demo");
  expect(after.compiled).not.toHaveProperty("github");

  // 錯誤碼可區分
  const invalid = await ctx.post("/api/profile/verify/github", {
    data: { username: "not a name!" },
  });
  expect(invalid.status()).toBe(400);
  expect(await errorOf(invalid)).toBe("invalid_username");
  const limited = await ctx.post("/api/profile/verify/github", {
    data: { username: "ratelimit-demo" },
  });
  expect(limited.status()).toBe(429);
  expect(await errorOf(limited)).toBe("rate_limited");
  const missing = await ctx.post("/api/profile/verify/github", {
    data: { username: "notfound-demo" },
  });
  expect(missing.status()).toBe(404);
  expect(await errorOf(missing)).toBe("not_found");

  const fresh = await newCtx(baseURL);
  await register(fresh, "noprof");
  const noProfile = await fresh.post("/api/profile/verify/github", {
    data: { username: "afly-demo" },
  });
  expect(noProfile.status()).toBe(400);
  expect(await errorOf(noProfile)).toBe("profile_missing");
});

test("跨來源 POST 得 403 bad_origin；同源與 GET 不受影響", async ({ baseURL }) => {
  const ctx = await newCtx(baseURL);
  const creds = { email: `nobody-${uniq()}@example.com`, password: PW };

  for (const origin of ["http://evil.example", "http://localhost:3001", "null"]) {
    const r = await ctx.post("/api/auth/login", { data: creds, headers: { Origin: origin } });
    expect(r.status(), origin).toBe(403);
    expect(await errorOf(r)).toBe("bad_origin");
  }
  const del = await ctx.delete("/api/me", { headers: { Origin: "http://evil.example" } });
  expect(del.status()).toBe(403);

  const same = await ctx.post("/api/auth/login", {
    data: creds,
    headers: { Origin: new URL(baseURL!).origin },
  });
  expect(same.status()).toBe(401);
  const noOrigin = await ctx.post("/api/auth/login", { data: creds });
  expect(noOrigin.status()).toBe(401);

  const get = await ctx.get("/api/users", { headers: { Origin: "http://evil.example" } });
  expect(get.status()).toBe(200);
});

test("DELETE /api/me：刪除後 /api/me 為 null、無法再登入；示範身分可刪、種子角色不可刪", async ({
  baseURL,
}) => {
  const ctx = await newCtx(baseURL);
  const { id, email } = await register(ctx, "del");
  await ctx.put("/api/profile", { data: { compiled: { role: "後端", skills: ["Go"] } } });

  const del = await ctx.delete("/api/me");
  expect(del.status()).toBe(200);
  expect((await (await ctx.get("/api/me")).json()).user).toBeNull();
  const relogin = await ctx.post("/api/auth/login", { data: { email, password: PW } });
  expect(relogin.status()).toBe(401);
  // 同 email 可重新註冊（資料已清空）
  const again = await newCtx(baseURL);
  const re = await again.post("/api/auth/register", {
    data: { email, password: PW, name: "Again" },
  });
  expect(re.status()).toBe(200);
  expect((await re.json()).id).not.toBe(id);

  // 示範身分
  const anon = await newCtx(baseURL);
  const created = await anon.post("/api/users", { data: { name: "刪除測試", emoji: "🧪" } });
  expect(created.status()).toBe(200);
  const demoId = (await created.json()).id as string;
  expect((await anon.post("/api/session", { data: { userId: demoId } })).status()).toBe(200);
  expect((await (await anon.get("/api/me")).json()).user.id).toBe(demoId);
  expect((await anon.delete("/api/me")).status()).toBe(200);
  expect((await (await anon.get("/api/me")).json()).user).toBeNull();
  expect((await demoRoster(anon)).map((u) => u.id)).not.toContain(demoId);

  // 種子角色是 demo 固定班底
  const seed = (await demoRoster(anon)).find((u) => String(u.id).startsWith("seed-"));
  expect(seed).toBeTruthy();
  expect((await anon.post("/api/session", { data: { userId: seed!.id } })).status()).toBe(200);
  const seedDel = await anon.delete("/api/me");
  expect(seedDel.status()).toBe(403);
  expect(await errorOf(seedDel)).toBe("seed_identity");

  // 未登入
  const nobody = await newCtx(baseURL);
  expect((await nobody.delete("/api/me")).status()).toBe(401);
});
