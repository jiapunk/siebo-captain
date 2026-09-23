import { spawnSync } from "node:child_process";
import { test, expect } from "@playwright/test";
import { BLACKHOLE_URL, ROOT, hermeticDecisionEnv } from "./helpers";

/**
 * 決策層（Jev → LLM → 規則）驗證，完全離線：
 * - 子行程只拿 hermeticDecisionEnv()（不展開 process.env），JEV_BASE_URL / LLM_BASE_URL 指向 127.0.0.1:9 黑洞，
 *   金鑰一律空字串 → 就算開發者 shell 有匯出真金鑰或 .env 有值，也不會連外、不會付費。
 * - 逐情境行為由 scripts/verify-decision.ts 在本機 stub server 上用真的 fetch 觸發，輸出 JSON 給這裡斷言。
 */

type Coverage = { expected: number; filled: number; remote: number; fallbacks: number; retries: number };
interface Scenario {
  ok: boolean;
  failures: string[];
  source?: string;
  note?: string | null;
  coverage?: Coverage;
  fallbackIds?: string[];
  answers?: Record<string, unknown>;
  requests?: { tier: "jev" | "llm"; questionIds: string[]; hasAuth: boolean }[];
  [k: string]: unknown;
}
interface VerifyOutput {
  ok: boolean;
  failed: string[];
  offline: boolean;
  stub: string;
  blackhole: string;
  chains: Record<string, string>;
  chainFailures: string[];
  scenarios: Record<string, Scenario>;
}

function runTsx(args: string[], env: NodeJS.ProcessEnv) {
  const r = spawnSync("npx", ["--no", "tsx", ...args], {
    cwd: ROOT,
    env,
    encoding: "utf-8",
    timeout: 60_000,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

let verify: VerifyOutput;
let verifyExit: number | null;

test.beforeAll(() => {
  // 呼叫端刻意給「會外連」的值，驗證腳本自己把每個情境的位址與金鑰都蓋掉
  const r = runTsx(
    ["scripts/verify-decision.ts", "--json"],
    hermeticDecisionEnv({ DECISION_PROVIDER: "jev" }),
  );
  const line = r.stdout.split("\n").find((l) => l.startsWith("VERIFY_DECISION_JSON "));
  expect(line, `verify-decision 沒有輸出 JSON\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBeTruthy();
  verify = JSON.parse(line!.slice("VERIFY_DECISION_JSON ".length)) as VerifyOutput;
  verifyExit = r.code;
});

test("三段鏈順序：依 key 與 DECISION_PROVIDER/FALLBACK 組出 Jev→LLM→規則", () => {
  expect(verify.chains).toMatchObject({
    auto_both_keys: "jev>llm>mock",
    auto_no_keys: "mock",
    auto_llm_only: "llm>mock",
    auto_jev_only: "jev>mock",
    fallback_mock_skips_llm: "jev>mock",
    provider_jev_no_key: "jev>mock",
  });
  expect(verify.chainFailures).toEqual([]);
  // DECISION_PROVIDER=mock：就算兩把 key 都在、位址指向 stub，一個請求都不發
  const pm = verify.scenarios.provider_mock_no_requests;
  expect(pm.source).toBe("mock");
  expect(pm.requests).toEqual([]);
});

test("fallback 實際穿過三段：Jev 401 → LLM 接手；LLM 壞 JSON → 規則；Jev 連不上 → 規則", () => {
  const llmOk = verify.scenarios.jev_401_llm_ok;
  expect(llmOk.failures).toEqual([]);
  expect(llmOk.source).toBe("llm");
  expect(llmOk.note).toMatch(/jev_failed: HTTP 401/);
  expect(llmOk.requests?.map((r) => r.tier)).toEqual(["jev", "llm"]);
  expect(llmOk.coverage).toMatchObject({ remote: 3, fallbacks: 0, retries: 0 });

  const bad = verify.scenarios.jev_401_llm_badjson_rules;
  expect(bad.source).toBe("mock");
  expect(bad.note).toMatch(/jev_failed/);
  expect(bad.note).toMatch(/llm_failed/);
  expect(bad.fallbackIds).toEqual(["goal_same", "skill_fit", "full_time"]);

  const unreachable = verify.scenarios.jev_unreachable_rules;
  expect(unreachable.source).toBe("mock");
  expect(unreachable.note).toMatch(/jev_failed/);
  expect(unreachable.note).not.toMatch(/llm_failed/);

  const none = verify.scenarios.no_keys_rules;
  expect(none.source).toBe("mock");
  expect(none.note ?? null).toBeNull();
});

test("覆蓋不足重試：第 1 次缺題 → 只重打缺漏題並補齊（retries=1、fallbacks=0）", () => {
  const s = verify.scenarios.coverage_retry;
  expect(s.failures).toEqual([]);
  expect(s.source).toBe("jev");
  expect(s.coverage).toMatchObject({ expected: 3, remote: 3, fallbacks: 0, retries: 1 });
  expect(s.requests?.map((r) => r.questionIds)).toEqual([
    ["goal_same", "skill_fit", "full_time"],
    ["skill_fit", "full_time"],
  ]);
});

test("逐題 fallback：不合法的那一題退回規則，其餘採用 Jev 答案", () => {
  const s = verify.scenarios.per_question_fallback;
  expect(s.failures).toEqual([]);
  expect(s.source).toBe("jev");
  expect(s.fallbackIds).toEqual(["goal_same"]);
  expect(s.coverage).toMatchObject({ expected: 3, remote: 2, fallbacks: 1, retries: 1 });
  // goal_same 是規則答案（different），skill_fit 是 Jev 答案（最高級 4）
  expect(s.answers).toMatchObject({ goal_same: "different", skill_fit: 4 });
  expect(s.requests?.[1]?.questionIds).toEqual(["goal_same"]);
});

test("斷路器：連續 3 次 Jev 失敗後第 4 次直接跳過（不再發請求）", () => {
  const s = verify.scenarios.circuit_breaker;
  expect(s.failures).toEqual([]);
  expect(s.breakerAfter3).toBe("open");
  expect(s.jevRequests).toBe(3);
  const notes = s.notes as string[];
  expect(notes.slice(0, 3).every((n) => /jev_failed: HTTP 500/.test(n))).toBe(true);
  expect(notes[3]).toMatch(/jev_circuit_open/);
  expect((s.fourth as Scenario).source).toBe("mock");
});

test("逾時涵蓋讀 body，且 hybrid 報告路徑帶 decisionSource=jev 與規則對照分", () => {
  const t = verify.scenarios.timeout_covers_body;
  expect(t.source).toBe("mock");
  expect(t.note).toMatch(/jev_failed: timeout/);
  expect(t.elapsedMs as number).toBeLessThan(2500);

  const h = verify.scenarios.hybrid_report;
  expect(h.failures).toEqual([]);
  expect(h.llmMode).toBe("hybrid");
  expect(h.decisionSource).toBe("jev");
  expect(typeof h.ruleScore).toBe("number");
  expect(h.score as number).toBeGreaterThanOrEqual(0);
  expect(h.score as number).toBeLessThanOrEqual(100);
  expect(h.decisionCoverage).toMatchObject({ expected: 8, remote: 8, fallbacks: 0 });

  // 整支腳本全綠（任何情境不符預期都會 exit 1）
  expect(verify.failed).toEqual([]);
  expect(verify.ok).toBe(true);
  expect(verifyExit).toBe(0);
  expect(verify.blackhole).toBe(BLACKHOLE_URL);
  expect(verify.stub).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
});

test("jev-smoke CLI：無 key 用本機規則；壞 key 打黑洞位址失敗後退回規則（不連外）", () => {
  const local = runTsx(["scripts/jev-smoke.ts"], hermeticDecisionEnv());
  expect(local.code, local.stderr).toBe(0);
  expect(local.stdout).toContain("chain=[mock]");
  expect(local.stdout).toContain("source=mock");
  expect(local.stdout).toContain(`jevBase=${BLACKHOLE_URL}`);

  const badKey = runTsx(["scripts/jev-smoke.ts", "--bad-key"], hermeticDecisionEnv());
  expect(badKey.code, badKey.stderr).toBe(0);
  expect(badKey.stdout).toContain("chain=[jev>mock]");
  expect(badKey.stdout).toContain("source=mock");
  expect(badKey.stdout).toMatch(/note=jev_failed: fetch failed/);
  expect(badKey.stdout).toContain(`jevBase=${BLACKHOLE_URL}`);
  expect(badKey.stdout).toContain(`llmBase=${BLACKHOLE_URL}`);
});
