import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { sqlitePathFromUrl } from "../prisma/db-path";
import { enterAsDemo, hermeticDecisionEnv, resetDemo, ROOT, type RunSummary } from "./helpers";

/**
 * 本機退路（LOCAL-FB）與 Part 失敗分支。
 * LLM_MODE 在 import 時決定，E2E server 固定 mock，所以 real 模式的引擎在子行程（tests/probes/swarm-probe.ts）裡跑：
 *   - LLM_PROVIDER=real + 假金鑰，LLM／Jev 端點全指向黑洞 127.0.0.1:9（探針會拒絕任何非本機迴路的端點）
 *   - 子行程寫進同一個測試 DB，再由 mock server 的 /api/agent/runs 與 /agent 頁讀出來驗 UI
 */

interface ProbePart {
  id: string;
  runId: string;
  kind: string;
  status: string;
  retries: number;
  provider: string | null;
  note: string | null;
}
interface FallbackRunResult {
  llmMode: string;
  runIds: string[];
  runs: { id: string; status: string; eventCount: number; hasReportA: boolean; hasReportB: boolean }[];
  parts: ProbePart[];
  summaries: Record<string, { expected: number; done: number; failed: number; fallbacks: number }>;
}
interface DrillResult {
  name: string;
  resolved: boolean;
  thrown: string | null;
  phases: string[];
  fnCalls: number;
  fallbackCalls: number;
  row: { status: string; retries: number; note: string | null; kind: string; teamId: string | null } | null;
}

function runProbe<T>(args: string[], env: NodeJS.ProcessEnv): T {
  const out = execFileSync("npx", ["--no", "tsx", "tests/probes/swarm-probe.ts", ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  const line = out
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("PROBE_RESULT "));
  expect(line, `探針沒有輸出 PROBE_RESULT：\n${out.slice(-2000)}`).toBeTruthy();
  return JSON.parse(line!.slice("PROBE_RESULT ".length)) as T;
}

/** real 模式 + LLM 不通：假金鑰（只會送到黑洞）、其餘一律 mock／關閉 */
function realModeDeadLlmEnv(): NodeJS.ProcessEnv {
  return hermeticDecisionEnv({
    LLM_PROVIDER: "real",
    LLM_API_KEY: "offline-dummy-key",
    LLM_TIMEOUT_MS: "2000",
    DECISION_PROVIDER: "mock",
    GITHUB_VERIFY: "mock",
    EVOMAP_ENABLED: "0",
  });
}

test.beforeAll(() => {
  resetDemo();
});

test("real 模式 LLM 不通：首個提問 Part 退回本機、之後降級，run 仍 completed，UI 標 LOCAL-FB", async ({
  page,
}) => {
  const probe = runProbe<FallbackRunResult>(["fallback-run", "Demo阿飛"], realModeDeadLlmEnv());
  expect(probe.llmMode, "子行程應在 real 模式").toBe("real");
  expect(probe.runIds.length).toBeGreaterThan(0);

  for (const run of probe.runs) {
    // run 本身不因 LLM 故障而失敗：逐字稿與雙方報告都在
    expect(run.status, `run ${run.id}`).toBe("completed");
    expect(run.hasReportA && run.hasReportB, `run ${run.id} 報告`).toBe(true);
    // 連線 + 訪談 + ≥1 組問答 ×2 輪 + 回訪 + 報告階段 + 雙方報告 + 完成 ≥ 11
    expect(run.eventCount, `run ${run.id} 逐字稿事件數`).toBeGreaterThanOrEqual(11);

    const parts = probe.parts.filter((p) => p.runId === run.id);
    expect(parts.map((p) => p.id).sort()).toEqual(
      [`a:${run.id}:A`, `a:${run.id}:B`, `q:${run.id}:A`, `q:${run.id}:B`, `r:${run.id}:A`, `r:${run.id}:B`].sort(),
    );
    for (const p of parts) {
      expect(p.status, p.id).toBe("done");
      expect(p.provider, `${p.id} 由本機腳本產生`).toBe("mock");
    }
    // 第一個 LLM Part：真的打過遠端（calls>0）且 Part 級重試過，才退回本機
    const first = parts.find((p) => p.id === `q:${run.id}:A`)!;
    expect(first.note ?? "", first.id).toMatch(/^fallback=local after: /);
    expect(first.note ?? "", first.id).toMatch(/attempts=2 calls=[1-9]\d*/);
    expect(first.retries, first.id).toBeGreaterThanOrEqual(1);
    // 其後的 Part：本場已降級，直接用本機腳本，不再各等一輪逾時（0 次遠端呼叫）
    for (const p of parts.filter((x) => x.id !== first.id)) {
      expect(p.note ?? "", p.id).toMatch(/^fallback=local: run degraded after an earlier LLM failure/);
      expect(p.note ?? "", p.id).toContain("calls=0");
      expect(p.retries, p.id).toBe(0);
    }
    expect(probe.summaries[run.id], `run ${run.id} 摘要`).toMatchObject({
      expected: 6,
      done: 6,
      failed: 0,
      fallbacks: 6,
    });
  }

  // mock server 讀同一個 DB：API 帶出 fallbacks，指揮台每張 run 卡都標 LOCAL-FB 6
  await enterAsDemo(page.request, "Demo阿飛");
  const { runs } = (await page.request.get("/api/agent/runs").then((r) => r.json())) as {
    runs: RunSummary[];
  };
  const mine = runs.filter((r) => probe.runIds.includes(r.id));
  expect(mine).toHaveLength(probe.runIds.length);
  for (const r of mine) {
    expect(r.status).toBe("completed");
    expect(r.parts, `run ${r.id}`).toMatchObject({ expected: 6, done: 6, failed: 0, fallbacks: 6 });
  }
  await page.goto("/agent");
  await expect(page.getByText(/^LOCAL-FB 6$/)).toHaveCount(probe.runIds.length, { timeout: 15_000 });
  await expect(page.getByText(/^PARTS 6\/6$/)).toHaveCount(probe.runIds.length);
});

test("沒有退路的 Part（team_eval）：一直失敗 → SwarmPart failed，錯誤往上拋", () => {
  // 臨時 DB：複製測試 DB，跑完刪掉（prisma/test-*.db 已被 .gitignore 涵蓋）
  const src = sqlitePathFromUrl(process.env.DATABASE_URL ?? "");
  expect(src, "DATABASE_URL 應是 SQLite 檔案").toBeTruthy();
  const tmp = src!.replace(/\.db$/, `-probe-${process.pid}.db`);
  copyFileSync(src!, tmp);
  try {
    const { results } = runProbe<{ results: DrillResult[] }>(
      ["part-fail"],
      hermeticDecisionEnv({ DATABASE_URL: `file:${tmp}`, DECISION_PROVIDER: "mock", EVOMAP_ENABLED: "0" }),
    );
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));

    // ① fn 一直丟錯、沒有 fallback：重試一次後標 failed，原始錯誤拋給呼叫端
    const plain = byName.nofallback;
    expect(plain.resolved).toBe(false);
    expect(plain.thrown).toBe("probe_always_fails");
    expect(plain.fnCalls).toBe(2);
    expect(plain.phases).toEqual(["pending", "running", "retry", "running", "failed"]);
    expect(plain.row).toMatchObject({ status: "failed", retries: 1, kind: "team_eval" });
    expect(plain.row?.note ?? "").toMatch(/^failed: probe_always_fails · attempts=2 calls=0/);

    // ② fallback 也失敗：仍是 failed，拋出的是 fn 的錯誤（不是 fallback 的）
    const fb = byName.fallbackfails;
    expect(fb.resolved).toBe(false);
    expect(fb.fallbackCalls).toBe(1);
    expect(fb.thrown).toBe("probe_always_fails");
    expect(fb.row).toMatchObject({ status: "failed", retries: 1 });

    // ③ 回傳值驗證不過：不會先標 done，同樣重試後 failed
    const inv = byName.invalid;
    expect(inv.resolved).toBe(false);
    expect(inv.thrown).toBe("probe_invalid_value");
    expect(inv.fnCalls).toBe(2);
    expect(inv.phases).not.toContain("done");
    expect(inv.row).toMatchObject({ status: "failed", retries: 1 });
  } finally {
    rmSync(tmp, { force: true });
    rmSync(`${tmp}-journal`, { force: true });
  }
});
