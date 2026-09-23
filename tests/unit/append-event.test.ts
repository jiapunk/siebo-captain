import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// 暫存 SQLite：不碰 prisma/dev.db。必須在載入 src/lib/db 之前設定（每個測試檔各自一個行程）
const dir = mkdtempSync(join(tmpdir(), "sd-append-"));
process.env.DATABASE_URL = `file:${join(dir, "append.db")}`;

type Db = typeof import("../../src/lib/db");
type Matching = typeof import("../../src/lib/matching");
let prisma: Db["prisma"];
let appendEvent: Matching["appendEvent"];

before(async () => {
  ({ prisma } = await import("../../src/lib/db"));
  ({ appendEvent } = await import("../../src/lib/matching"));
  // 依序套用 prisma/migrations（與 prisma migrate deploy 同一份 SQL）
  const migDir = resolve(__dirname, "../../prisma/migrations");
  for (const m of readdirSync(migDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const sql = readFileSync(join(migDir, m, "migration.sql"), "utf8");
    for (const stmt of sql.split(/;\s*\n/).map((s) => s.replace(/^--.*$/gm, "").trim()).filter(Boolean))
      await prisma.$executeRawUnsafe(stmt);
  }
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

test("appendEvent：同一個 run 並行追加 10 筆，一筆都不會遺失", async () => {
  const run = await prisma.matchRun.create({ data: { userAId: "a", userBId: "b", events: [] } });
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => appendEvent(run.id, { type: "phase", text: `e${i}` })),
  );
  const row = await prisma.matchRun.findUnique({ where: { id: run.id } });
  const events = row?.events as unknown as { type: string; text: string; ts: number }[];
  assert.equal(events.length, 10);
  assert.deepEqual(
    events.map((e) => e.text).sort(),
    Array.from({ length: 10 }, (_, i) => `e${i}`).sort(),
  );
  assert.ok(events.every((e) => e.type === "phase" && typeof e.ts === "number"));
});

test("appendEvent：循序追加維持順序；不存在的 run 不報錯也不建立資料", async () => {
  const run = await prisma.matchRun.create({ data: { userAId: "a", userBId: "c", events: [] } });
  for (const t of ["one", "two", "three"]) await appendEvent(run.id, { type: "phase", text: t });
  const row = await prisma.matchRun.findUnique({ where: { id: run.id } });
  assert.deepEqual(
    (row?.events as unknown as { text: string }[]).map((e) => e.text),
    ["one", "two", "three"],
  );
  await appendEvent("no-such-run", { type: "phase", text: "x" });
  assert.equal(await prisma.matchRun.count({ where: { id: "no-such-run" } }), 0);
});
