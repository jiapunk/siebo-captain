import { execSync } from "node:child_process";
import { test, expect } from "@playwright/test";

/**
 * 決策層（Jev）fallback 驗證：
 * 故意帶入無效 key → Jev 401 → 必須自動退回本機規則（source=mock）且流程不中斷。
 * 注意：此測試會嘗試連外；即使離線（網路錯誤）也應走同一 fallback 路徑。
 */
test("決策層 fallback：無效 Jev key 時改用本機規則", () => {
  const out = execSync("npx tsx scripts/jev-smoke.ts --bad-key", {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: { ...process.env, DECISION_PROVIDER: "auto" },
    timeout: 60_000,
  });
  expect(out).toContain("source=mock");
  expect(out).toMatch(/note=jev_failed/);
});

test("三段鏈順序：有 LLM key 時 Jev→LLM→規則，無 key 時純規則", () => {
  const withLlm = execSync(
    "npx tsx -e \"import {decisionChain} from './src/lib/llm/decide'; console.log(decisionChain().join('>'))\"",
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: { ...process.env, JEV_API_KEY: "k", LLM_API_KEY: "k" },
      timeout: 60_000,
    },
  );
  expect(withLlm.trim()).toBe("jev>llm>mock");

  const rulesOnly = execSync(
    "npx tsx -e \"import {decisionChain} from './src/lib/llm/decide'; console.log(decisionChain().join('>'))\"",
    {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: { ...process.env, JEV_API_KEY: "", LLM_API_KEY: "" },
      timeout: 60_000,
    },
  );
  expect(rulesOnly.trim()).toBe("mock");
});

test("決策層本機模式：未設定 key 時直接使用規則", () => {
  const out = execSync("npx tsx scripts/jev-smoke.ts", {
    cwd: process.cwd(),
    encoding: "utf-8",
    env: { ...process.env, JEV_API_KEY: "", DECISION_PROVIDER: "auto" },
    timeout: 60_000,
  });
  expect(out).toContain("source=mock");
  expect(out).toContain("ms=");
});
