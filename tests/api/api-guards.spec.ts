import { createHash, randomBytes } from "node:crypto";
import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
} from "@playwright/test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { absoluteDatabaseUrl } from "../../prisma/db-path";

/**
 * API 防護（api 組）：IDOR、成本防護、聯絡邀請→接受、組隊需全員同意、多工逐字稿串流。
 * 只用 request（不開 UI）。測試帳號直接寫進測試 DB（playwright.config.ts 設定的 prisma/test-<port>.db）：
 * 有 email、已驗證的「真人帳號」＋一筆 Session（與 src/lib/auth.ts createSession 相同：只存 token 的 SHA-256），
 * 不走 /api/auth/register，避免和 auth 測試共用註冊節流額度。結束時刪掉自己建立的資料。
 */

const db = new PrismaClient({ datasources: { db: { url: absoluteDatabaseUrl() } } });

const createdUsers: string[] = [];
let ctxs: APIRequestContext[] = [];
let eventId = "";
let botId = "";
let botCompiled: Prisma.InputJsonValue = {};
let botVisibility: Prisma.InputJsonValue = {};

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

test.beforeAll(async () => {
  const ev = await db.event.findFirst({ orderBy: { startsAt: "desc" } });
  expect(ev, "globalSetup 應已建立活動").not.toBeNull();
  eventId = ev!.id;
  const bot = await db.user.findFirst({
    where: { isBot: true, profile: { status: "ready" } },
    include: { profile: true },
  });
  expect(bot?.profile?.compiled, "種子應有 ready 的模擬隊友").toBeTruthy();
  botId = bot!.id;
  botCompiled = bot!.profile!.compiled as Prisma.InputJsonValue;
  botVisibility = (bot!.profile!.visibility ?? {}) as Prisma.InputJsonValue;
});

test.afterEach(async () => {
  await Promise.all(ctxs.map((c) => c.dispose()));
  ctxs = [];
});

test.afterAll(async () => {
  const ids = createdUsers.splice(0);
  if (ids.length > 0) {
    const runs = await db.matchRun.findMany({
      where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);
    await db.swarmPart.deleteMany({ where: { runId: { in: runIds } } });
    await db.soloBaseline.deleteMany({ where: { runId: { in: runIds } } });
    await db.icebreaker.deleteMany({ where: { runId: { in: runIds } } });
    await db.matchRun.deleteMany({ where: { id: { in: runIds } } });
    await db.connection.deleteMany({
      where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] },
    });
    await db.ledgerEvent.deleteMany({ where: { userId: { in: ids } } });
    await db.team.deleteMany({ where: { members: { some: { userId: { in: ids } } } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
  await db.$disconnect();
});

/** 建一個真人帳號（有 email；預設已驗證、已加入活動） */
async function makeUser(
  tag: string,
  opts: { verified?: boolean; ready?: boolean } = {},
): Promise<string> {
  const u = await db.user.create({
    data: {
      name: `G-${tag}`.slice(0, 12),
      emoji: "🧪",
      email: `guard-${tag}-${uniq()}@example.com`.toLowerCase(),
      passwordHash: "unused:unused",
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      profile: {
        create: opts.ready
          ? {
              status: "ready",
              interview: [],
              compiled: { ...(botCompiled as object), nickname: tag },
              visibility: botVisibility,
            }
          : { status: "draft", interview: [] },
      },
      events: { create: { eventId } },
    },
  });
  createdUsers.push(u.id);
  return u.id;
}

/** 以該帳號登入的 request context（sc_sid 與 createSession 同格式） */
async function login(userId: string, baseURL: string | undefined) {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      id: createHash("sha256").update(token).digest("hex"),
      userId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  const ctx = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `sc_sid=${token}; sc_lang=zh` },
  });
  ctxs.push(ctx);
  return ctx;
}

async function anon(baseURL: string | undefined) {
  const ctx = await pwRequest.newContext({ baseURL });
  ctxs.push(ctx);
  return ctx;
}

const report = (score: number) => ({
  score,
  verdict: "recommend",
  dimensions: { interests: score, values: score, lifestyle: score, communication: score, intent: score },
  reasons: ["r1", "r2"],
  redFlags: [],
  sharedTopics: ["t1"],
  summaryForUser: "summary",
});

/** 直接寫一場已完成的互盤（A→B 分數、B→A 分數） */
async function completedRun(a: string, b: string, scoreA = 80, scoreB = 80) {
  const ts = Date.now();
  const run = await db.matchRun.create({
    data: {
      userAId: a,
      userBId: b,
      eventId,
      status: "completed",
      events: [
        { type: "phase", text: "link", ts },
        { type: "question", side: "A", text: "Q1?", ts: ts + 1 },
        { type: "answer", side: "B", text: "A1.", ts: ts + 2 },
        { type: "done", text: "ok", matchId: null, ts: ts + 3 },
      ],
      reportA: report(scoreA),
      reportB: report(scoreB),
    },
  });
  return run.id;
}

/** 把 SSE body 解析成 data 物件陣列 */
function parseSse(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .map((chunk) => chunk.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice("data: ".length)) as Record<string, unknown>);
}

test("compare：非當事人讀不到也不能重跑；當事人重跑每分鐘 1 次", async ({ baseURL }) => {
  const a = await makeUser("cmpA", { ready: true });
  const b = await makeUser("cmpB", { ready: true });
  const outsider = await makeUser("cmpC");
  const runId = await completedRun(a, b);

  const c = await login(outsider, baseURL);
  const g = await c.get(`/api/compare?runId=${runId}`);
  expect(g.status()).toBe(403);
  expect((await g.json()).error).toBe("forbidden");
  const p = await c.post("/api/compare", { data: { runId, force: true } });
  expect(p.status()).toBe(403);
  expect(await db.soloBaseline.count({ where: { runId } })).toBe(0);

  const ca = await login(a, baseURL);
  const cb = await login(b, baseURL);
  const ga = await ca.get(`/api/compare?runId=${runId}`);
  expect(ga.status()).toBe(200);
  expect((await ga.json()).viewerSide).toBe("A");
  const gb = await cb.get(`/api/compare?runId=${runId}`);
  expect(gb.status()).toBe(200);
  expect((await gb.json()).viewerSide).toBe("B");

  // 壞 JSON → 400（不是 500）
  const bad = await ca.post("/api/compare", {
    data: "{not json",
    headers: { "content-type": "application/json" },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toBe("invalid_json");

  // 第一次真的跑（mock）→ 200；一分鐘內再 force → 429；沒 force 用快取 → 200
  const first = await ca.post("/api/compare", { data: { runId } });
  expect(first.status(), await first.text()).toBe(200);
  const again = await ca.post("/api/compare", { data: { runId, force: true } });
  expect(again.status()).toBe(429);
  const body = await again.json();
  expect(body.error).toBe("rate_limited");
  expect(body.retryAfterSec).toBeGreaterThan(0);
  const cached = await cb.post("/api/compare", { data: { runId } });
  expect(cached.status()).toBe(200);
});

test("多工逐字稿串流：非成員 403、參數檢查、已完成的 run 補歷史後關閉", async ({ baseURL }) => {
  const a = await makeUser("msA");
  const b = await makeUser("msB");
  const outsider = await makeUser("msC");
  const theirRun = await completedRun(a, b);
  const myRun = await completedRun(outsider, botId);

  const nobody = await anon(baseURL);
  expect((await nobody.get(`/api/agent/runs/stream?ids=${myRun}`)).status()).toBe(401);

  const c = await login(outsider, baseURL);
  const forbidden = await c.get(`/api/agent/runs/stream?ids=${theirRun}`);
  expect(forbidden.status()).toBe(403);
  expect(await forbidden.json()).toMatchObject({ error: "forbidden", runIds: [theirRun] });
  const mixed = await c.get(`/api/agent/runs/stream?ids=${myRun},${theirRun}`);
  expect(mixed.status()).toBe(403);
  // 舊的單 run 路由維持 404
  expect((await c.get(`/api/agent/runs/${theirRun}/stream`)).status()).toBe(404);

  expect((await c.get("/api/agent/runs/stream")).status()).toBe(400);
  const nine = Array.from({ length: 9 }, (_, i) => `r${i}`).join(",");
  const tooMany = await c.get(`/api/agent/runs/stream?ids=${nine}`);
  expect(tooMany.status()).toBe(400);
  expect((await tooMany.json()).error).toBe("invalid_ids");

  const ok = await c.get(`/api/agent/runs/stream?ids=${myRun}`, { timeout: 30_000 });
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toContain("text/event-stream");
  const msgs = parseSse(await ok.text());
  const events = msgs.filter((m) => m.type === "event");
  expect(events).toHaveLength(4);
  expect(events.every((m) => m.runId === myRun)).toBe(true);
  expect(events.map((m) => m.seq)).toEqual([0, 1, 2, 3]);
  expect(msgs).toContainEqual({ type: "ready", runId: myRun, status: "completed" });
  expect(msgs).toContainEqual({ type: "run_closed", runId: myRun, status: "completed" });
  expect(msgs[msgs.length - 1]).toEqual({ type: "closed" });
});

test("隊長出發：執行中重送 409 already_running；多工串流一條連線看完全部 run", async ({ baseURL }) => {
  test.setTimeout(120_000);
  const d = await makeUser("match", { ready: true });
  const cd = await login(d, baseURL);

  const first = await cd.post("/api/matching/run", { data: {} });
  expect(first.status(), await first.text()).toBe(200);
  const { runIds } = (await first.json()) as { runIds: string[] };
  expect(runIds.length).toBeGreaterThan(0);

  const second = await cd.post("/api/matching/run", { data: {} });
  expect(second.status()).toBe(409);
  const busy = await second.json();
  expect(busy.error).toBe("already_running");
  expect([...busy.runIds].sort()).toEqual([...runIds].sort());

  // 一條 SSE 看完全部 run：每場都有 ready / done 事件 / run_closed，最後 closed
  const stream = await cd.get(`/api/agent/runs/stream?ids=${runIds.join(",")}`, {
    timeout: 100_000,
  });
  expect(stream.status()).toBe(200);
  const msgs = parseSse(await stream.text());
  for (const id of runIds) {
    expect(msgs.some((m) => m.type === "ready" && m.runId === id)).toBe(true);
    expect(msgs.some((m) => m.type === "run_closed" && m.runId === id)).toBe(true);
    const evs = msgs.filter((m) => m.type === "event" && m.runId === id);
    const seqs = evs.map((m) => m.seq as number);
    expect(new Set(seqs).size, `run ${id} 事件不應重複`).toBe(seqs.length);
    expect(evs.some((m) => (m.event as { type: string }).type === "done")).toBe(true);
  }
  expect(msgs[msgs.length - 1]).toEqual({ type: "closed" });

  // 跑完就能再出發（不再 409 already_running）
  const runs = await db.matchRun.count({ where: { userAId: d, status: "running" } });
  expect(runs).toBe(0);
});

test("持續聯絡：真人對真人要對方接受；重複邀請不產生重複資料；未驗證帳號被擋", async ({ baseURL }) => {
  const e = await makeUser("connE");
  const f = await makeUser("connF");
  const g = await makeUser("connG");
  const u = await makeUser("connU", { verified: false });
  const ce = await login(e, baseURL);
  const cf = await login(f, baseURL);
  const cg = await login(g, baseURL);
  const cu = await login(u, baseURL);

  // 未驗證 Email → 403 email_unverified
  const blocked = await cu.post("/api/connections", { data: { userId: e } });
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).error).toBe("email_unverified");
  // 壞 JSON → 400
  const bad = await ce.post("/api/connections", {
    data: "nope",
    headers: { "content-type": "application/json" },
  });
  expect(bad.status()).toBe(400);

  // E 邀請 F → requested / outgoing
  const inv = await ce.post("/api/connections", { data: { userId: f } });
  expect(inv.status()).toBe(200);
  const conn = await inv.json();
  expect(conn).toMatchObject({ status: "requested", direction: "outgoing", created: true });
  // 重送：同一筆、不新增
  const dup = await ce.post("/api/connections", { data: { userId: f } });
  expect(await dup.json()).toMatchObject({ id: conn.id, status: "requested", created: false });
  expect(
    await db.connection.count({
      where: { OR: [{ userAId: e, userBId: f }, { userAId: f, userBId: e }] },
    }),
  ).toBe(1);

  // 清單：E 看到 outgoing、F 看到 incoming
  const le = await (await ce.get("/api/connections")).json();
  expect(le.outgoing.map((c: { id: string }) => c.id)).toContain(conn.id);
  const lf = await (await cf.get("/api/connections")).json();
  expect(lf.incoming.map((c: { id: string }) => c.id)).toContain(conn.id);
  expect(lf.connections.find((c: { id: string }) => c.id === conn.id).direction).toBe("incoming");

  // 還沒接受：不能私訊；發起者不能自己接受；外人看不到
  expect((await ce.post(`/api/connections/${conn.id}/messages`, { data: { content: "hi" } })).status()).toBe(423);
  const self = await ce.post(`/api/connections/${conn.id}/accept`);
  expect(self.status()).toBe(403);
  expect((await self.json()).error).toBe("not_invitee");
  expect((await cg.post(`/api/connections/${conn.id}/accept`)).status()).toBe(404);
  expect((await cg.get(`/api/connections/${conn.id}`)).status()).toBe(404);

  // F 接受 → connected；再按一次冪等
  const acc = await cf.post(`/api/connections/${conn.id}/accept`);
  expect(acc.status()).toBe(200);
  expect(await acc.json()).toEqual({ id: conn.id, status: "connected" });
  expect((await cf.post(`/api/connections/${conn.id}/accept`)).status()).toBe(200);
  const st = await (await ce.get(`/api/connections/${conn.id}`)).json();
  expect(st).toMatchObject({ status: "connected", direction: null });

  // 帳本各一筆；再 POST 不會重複記帳
  await ce.post("/api/connections", { data: { userId: f } });
  expect(await db.ledgerEvent.count({ where: { userId: e, kind: "connection" } })).toBe(1);
  expect(await db.ledgerEvent.count({ where: { userId: f, kind: "connection" } })).toBe(1);

  // 接受後可以私訊
  const msg = await ce.post(`/api/connections/${conn.id}/messages`, { data: { content: "嗨" } });
  expect(msg.status()).toBe(200);
});

test("組隊：兩位真人都同意才成立；bot 視為已同意；成立後收回其他提案", async ({ baseURL }) => {
  const h1 = await makeUser("teamH1");
  const h2 = await makeUser("teamH2");
  const outsider = await makeUser("teamX");
  const team = await db.team.create({
    data: {
      eventId,
      status: "proposed",
      score: 77,
      members: {
        create: [
          { userId: h1, role: "前端", accepted: false },
          { userId: h2, role: "後端", accepted: false },
          { userId: botId, role: "設計", accepted: false },
        ],
      },
    },
  });
  // H2 的另一個未成立提案：本隊成立後應被收回
  const other = await db.team.create({
    data: {
      eventId,
      status: "proposed",
      score: 65,
      members: { create: [{ userId: h2, role: "後端" }, { userId: botId, role: "設計" }] },
    },
  });

  const c1 = await login(h1, baseURL);
  const c2 = await login(h2, baseURL);
  const cx = await login(outsider, baseURL);

  expect((await cx.get(`/api/teams/${team.id}`)).status()).toBe(404);
  expect((await cx.post(`/api/teams/${team.id}`)).status()).toBe(404);

  // H1 同意 → 仍是 proposed，等 H2
  const j1 = await c1.post(`/api/teams/${team.id}`);
  expect(j1.status()).toBe(200);
  expect(await j1.json()).toEqual({ status: "proposed", pending: [h2] });
  const view = await (await c1.get(`/api/teams/${team.id}`)).json();
  expect(view.status).toBe("proposed");
  const acc = Object.fromEntries(
    view.members.map((m: { userId: string; accepted: boolean }) => [m.userId, m.accepted]),
  );
  expect(acc).toEqual({ [h1]: true, [h2]: false, [botId]: true });
  expect(view.pending).toEqual([h2]);
  // 未成立不能群聊、H2 也沒被記帳
  expect((await c1.post(`/api/teams/${team.id}/messages`, { data: { content: "hi" } })).status()).toBe(423);
  expect(await db.ledgerEvent.count({ where: { refId: team.id, kind: "team_joined" } })).toBe(0);

  // H2 同意 → assembled，每位真人各一筆 team_joined，bot 不記
  const j2 = await c2.post(`/api/teams/${team.id}`);
  expect(await j2.json()).toEqual({ status: "assembled", pending: [] });
  expect((await db.team.findUnique({ where: { id: team.id } }))?.status).toBe("assembled");
  const ledger = await db.ledgerEvent.findMany({ where: { refId: team.id, kind: "team_joined" } });
  expect(ledger.map((l) => l.userId).sort()).toEqual([h1, h2].sort());
  expect(await db.team.findUnique({ where: { id: other.id } })).toBeNull();

  // 再按一次不會重複記帳
  await c1.post(`/api/teams/${team.id}`);
  expect(await db.ledgerEvent.count({ where: { refId: team.id, kind: "team_joined" } })).toBe(2);
});

test("訪談：訊息長度上限、壞 JSON 回 400", async ({ baseURL }) => {
  const u = await makeUser("onb");
  const cu = await login(u, baseURL);
  const long = await cu.post("/api/onboarding/message", { data: { content: "字".repeat(1001) } });
  expect(long.status()).toBe(400);
  expect(await long.json()).toMatchObject({ error: "content_too_long", max: 1000 });
  const bad = await cu.post("/api/onboarding/message", {
    data: "[1,2",
    headers: { "content-type": "application/json" },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toBe("invalid_json");
  const ok = await cu.post("/api/onboarding/message", { data: { content: "我是前端，全程投入" } });
  expect(ok.status(), await ok.text()).toBe(200);
});
