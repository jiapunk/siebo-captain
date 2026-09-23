import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// 暫存 SQLite：不碰 prisma/dev.db；引擎一律離線。必須在載入 src/lib/* 之前設定（每個測試檔各自一個行程）
const dir = mkdtempSync(join(tmpdir(), "sd-match-event-"));
process.env.DATABASE_URL = `file:${join(dir, "match.db")}`;
process.env.LLM_PROVIDER = "mock";
process.env.DECISION_PROVIDER = "mock";
process.env.GITHUB_VERIFY = "mock";
process.env.EVOMAP_ENABLED = "0";

type Db = typeof import("../../src/lib/db");
type Matching = typeof import("../../src/lib/matching");
let prisma: Db["prisma"];
let pickCandidates: Matching["pickCandidates"];
let startMatching: Matching["startMatching"];

const compiled = (nickname: string, role: string) => ({
  nickname,
  role,
  skills: ["TypeScript", "React"],
  timezone: "Asia/Taipei",
  availability: "全程投入（48 小時都在）",
  goal: "想拿獎",
  workingStyle: "邊做邊改",
  vibe: "",
  dealbreakers: [],
  bio: "",
});

let eventA = "";
let eventB = "";

async function readyUser(id: string, role: string, eventId: string | null) {
  await prisma.user.create({
    data: {
      id,
      name: id,
      emoji: "🧪",
      profile: { create: { status: "ready", interview: [], compiled: compiled(id, role) } },
      ...(eventId ? { events: { create: { eventId } } } : {}),
    },
  });
}

before(async () => {
  ({ prisma } = await import("../../src/lib/db"));
  ({ pickCandidates, startMatching } = await import("../../src/lib/matching"));
  // 依序套用 prisma/migrations（與 prisma migrate deploy 同一份 SQL）
  const migDir = resolve(__dirname, "../../prisma/migrations");
  for (const m of readdirSync(migDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const sql = readFileSync(join(migDir, m, "migration.sql"), "utf8");
    for (const stmt of sql.split(/;\s*\n/).map((s) => s.replace(/^--.*$/gm, "").trim()).filter(Boolean))
      await prisma.$executeRawUnsafe(stmt);
  }
  eventA = (await prisma.event.create({ data: { name: "A", code: "EVA", startsAt: new Date() } })).id;
  eventB = (await prisma.event.create({ data: { name: "B", code: "EVB", startsAt: new Date() } })).id;
  await readyUser("me", "前端", eventA);
  await readyUser("peer", "後端", eventA);
  await readyUser("other-event", "設計", eventB);
  await readyUser("no-event", "PM", null);
  await readyUser("no-event-2", "資料", null);
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

test("沒有 EventMember：拿不到任何候選（不做全域查詢），即使有 ready 的使用者", async () => {
  assert.deepEqual(await pickCandidates("no-event", null), []);
  // 其他 ready 使用者都在：me／peer／other-event／no-event-2
  assert.equal(await prisma.user.count({ where: { id: { not: "no-event" }, profile: { status: "ready" } } }), 4);
});

test("沒有 EventMember：startMatching 丟 NO_EVENT，不建立任何 run", async () => {
  const pending: Promise<void>[] = [];
  await assert.rejects(
    startMatching("no-event", "zh", { defer: (p) => pending.push(p) }),
    /NO_EVENT/,
  );
  assert.equal(pending.length, 0);
  assert.equal(
    await prisma.matchRun.count({ where: { OR: [{ userAId: "no-event" }, { userBId: "no-event" }] } }),
    0,
  );
});

test("有活動：候選只限同一場活動的成員（沒活動的、別場活動的都不會出現）", async () => {
  assert.deepEqual(await pickCandidates("me", eventA), ["peer"]);
  assert.deepEqual(await pickCandidates("other-event", eventB), []);
});

test("startMatching：每場 runPair 的 promise 交給 defer 追蹤，等它們結束後 run 已收尾（不再 running）", async () => {
  const pending: Promise<void>[] = [];
  const runIds = await startMatching("me", "zh", { defer: (p) => pending.push(p) });
  assert.equal(runIds.length, 1);
  assert.equal(pending.length, runIds.length);
  const settled = await Promise.allSettled(pending);
  assert.ok(settled.every((s) => s.status === "fulfilled"), "runPair 的 promise 已接 .catch，不會 reject");
  const run = await prisma.matchRun.findUniqueOrThrow({ where: { id: runIds[0] } });
  assert.equal(run.status, "completed");
  assert.equal(run.userBId, "peer");
  assert.equal(run.eventId, eventA);
});
