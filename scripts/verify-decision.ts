/**
 * 決策層驗證（完全離線、零成本）：
 *   在本機起一個 stub HTTP server，同時扮演 Jev（/systemone）與 OpenAI 相容 LLM（/chat/completions），
 *   用「真的 fetch」走完 decide() 的三段鏈，逐一觸發：
 *     - 三段鏈順序（decisionChain 在各種 env 組合下的結果）
 *     - Jev 401 → LLM 接手（source=llm）；LLM 回壞 JSON → 規則（source=mock）
 *     - Jev 連不上（黑洞位址）→ 規則
 *     - 覆蓋不足重試：第 1 次缺題 → 第 2 次「只送缺漏題」補齊（coverage.retries=1、fallbacks=0）
 *     - 逐題 fallback：某題兩次都不合法 → 只有那題退回規則（fallbackIds=[該題]）
 *     - 斷路器：連續 3 次失敗後第 4 次直接跳過 Jev（note 含 jev_circuit_open，stub 收不到第 4 個請求）
 *     - 逾時涵蓋讀 body：標頭已回、body 卡住 → JEV_TIMEOUT_MS 內放棄
 *     - hybrid 報告路徑：LLM_PROVIDER=hybrid 時 llm.matchReport 帶 decisionSource=jev 與 ruleScore
 *
 * 所有外部位址都在這支腳本裡明確設定（stub 或 http://127.0.0.1:9 黑洞），不讀 .env、不受呼叫端 shell 影響，
 * 絕不連外。要實打真 Jev 請用 `npx tsx scripts/jev-smoke.ts`（會讀 .env 的金鑰）。
 *
 * 執行：
 *   npx tsx scripts/verify-decision.ts          # 人看的摘要 + 最後一行 JSON
 *   npx tsx scripts/verify-decision.ts --json   # 只輸出 JSON（tests/decision.spec.ts 用）
 * 最後一行固定是 `VERIFY_DECISION_JSON {...}`；任何情境不符預期 → exit 1。
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";
import {
  _resetDecideState,
  decide,
  decisionChain,
  jevBreaker,
  type DecideAnswer,
  type DecideQuestion,
  type DecideResult,
} from "../src/lib/llm/decide";

const JSON_ONLY = process.argv.includes("--json");
const log = (...a: unknown[]) => {
  if (!JSON_ONLY) console.log(...a);
};

/** 不可達位址：就算某個情境漏設 stub，也只會在本機立刻連線失敗 */
const BLACKHOLE = "http://127.0.0.1:9";

// ---------------- 決策題與規則答案 ----------------
const QUESTIONS: DecideQuestion[] = [
  {
    id: "goal_same",
    type: "choice",
    instructions: "Do both people share the same hackathon goal?",
    criteria: { same: "Same goal", different: "Different goals" },
  },
  {
    id: "skill_fit",
    type: "score",
    instructions: "How complementary are their skills for a hackathon team?",
    criteria: ["None", "Weak", "Fair", "Good", "Ideal"],
  },
  {
    id: "full_time",
    type: "noul",
    instructions: "Are both able to commit full-time for 48 hours?",
  },
];
const RULE: Record<string, DecideAnswer> = {
  goal_same: { id: "goal_same", type: "choice", value: "different", confidence: 1, probabilities: {} },
  skill_fit: { id: "skill_fit", type: "score", value: 1, confidence: 1, probabilities: {} },
  full_time: { id: "full_time", type: "noul", value: 0.25 },
};
const fallback = (q: DecideQuestion): DecideAnswer => RULE[q.id];
const STATE = {
  me: { role: "fullstack", skills: ["TypeScript", "React"], goal: "win", availability: "full-time" },
  them: { role: "design", skills: ["Figma"], goal: "win", availability: "full-time" },
};

// ---------------- stub server ----------------
interface StubReq {
  tier: "jev" | "llm";
  scenario: string;
  behavior: string;
  questionIds: string[];
  hasAuth: boolean;
}
const requests: StubReq[] = [];

type WireQ = { id: string; type: string; criteria?: unknown };

/** 依題型給一個合法答案（Jev 與 LLM 的答案格式相同） */
function validAnswer(q: WireQ): Record<string, unknown> {
  if (q.type === "noul") return { noul: 0.8 };
  if (q.type === "choice") {
    const key = Object.keys((q.criteria as Record<string, unknown>) ?? {})[0] ?? "";
    return { choice: key, confidence: 0.9, probabilities: { [key]: 0.9 } };
  }
  const n = Array.isArray(q.criteria) ? q.criteria.length : 1;
  return { score: Math.max(0, n - 1), confidence: 0.9, probabilities: {} };
}

const sockets = new Set<Socket>();

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = "";
    req.setEncoding("utf8");
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

/** 路徑：/jev/<scenario>/<behavior>/systemone、/llm/<scenario>/<behavior>/chat/completions */
async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const [, tier, scenario, behavior] = (req.url ?? "").split("/");
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    /* 壞 body 照樣記錄 */
  }

  if (tier === "jev") {
    const qs = Object.values((body.questions as Record<string, WireQ>) ?? {});
    requests.push({
      tier: "jev",
      scenario,
      behavior,
      questionIds: qs.map((q) => q.id),
      hasAuth: Boolean(req.headers.authorization),
    });
    const nth = requests.filter((r) => r.tier === "jev" && r.scenario === scenario).length;
    const answerAll = (map: (q: WireQ) => Record<string, unknown> = validAnswer) =>
      Object.fromEntries(qs.map((q) => [q.id, map(q)]));
    const usage = { input_tokens: 42, output_tokens: 7 };
    switch (behavior) {
      case "ok":
        return sendJson(res, 200, { model: "jev-stub", answers: answerAll(), usage });
      case "401":
        return sendJson(res, 401, { detail: { error_type: "authentication_error" } });
      case "500":
        return sendJson(res, 500, { error: "stub upstream failure" });
      case "partial":
        // 第 1 次只回第一題 → decide 應只針對缺漏題重打；第 2 次全回
        return sendJson(res, 200, {
          model: "jev-stub",
          answers: nth === 1 ? { [qs[0].id]: validAnswer(qs[0]) } : answerAll(),
          usage,
        });
      case "invalid-choice":
        // choice 題永遠回不在枚舉內的值 → 只有那題退回規則
        return sendJson(res, 200, {
          model: "jev-stub",
          answers: answerAll((q) =>
            q.type === "choice" ? { choice: "banana", confidence: 1 } : validAnswer(q),
          ),
          usage,
        });
      case "slow-body":
        // 標頭先到、body 永遠不結束：逾時必須涵蓋讀 body
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"answers":');
        return;
      default:
        return sendJson(res, 404, { error: "unknown behavior" });
    }
  }

  if (tier === "llm") {
    const messages = (body.messages as { role: string; content: string }[]) ?? [];
    const user = messages.find((m) => m.role === "user")?.content ?? "";
    let qs: WireQ[] = [];
    try {
      qs = JSON.parse(user.split("QUESTIONS:\n")[1] ?? "[]");
    } catch {
      qs = [];
    }
    requests.push({
      tier: "llm",
      scenario,
      behavior,
      questionIds: qs.map((q) => q.id),
      hasAuth: Boolean(req.headers.authorization),
    });
    const content =
      behavior === "badjson"
        ? "Sorry, I can't answer that in JSON."
        : JSON.stringify({ answers: Object.fromEntries(qs.map((q) => [q.id, validAnswer(q)])) });
    return sendJson(res, 200, {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
  }

  sendJson(res, 404, { error: "not found" });
}

// ---------------- 工具 ----------------
const DECISION_ENV_KEYS = [
  "DECISION_PROVIDER",
  "DECISION_FALLBACK",
  "JEV_API_KEY",
  "JEV_BASE_URL",
  "JEV_MODEL",
  "JEV_TIMEOUT_MS",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "DECISION_LLM_TIMEOUT_MS",
] as const;
type DecisionEnv = Partial<Record<(typeof DECISION_ENV_KEYS)[number], string>>;

/** 每個情境都從同一組「全部明確設定」的 env 出發（不吃呼叫端 shell 的金鑰或位址） */
const BASE_ENV: Required<DecisionEnv> = {
  DECISION_PROVIDER: "auto",
  DECISION_FALLBACK: "auto",
  JEV_API_KEY: "",
  JEV_BASE_URL: BLACKHOLE,
  JEV_MODEL: "jev-stub",
  JEV_TIMEOUT_MS: "3000",
  LLM_API_KEY: "",
  LLM_BASE_URL: BLACKHOLE,
  LLM_MODEL: "llm-stub",
  DECISION_LLM_TIMEOUT_MS: "3000",
};

function applyEnv(env: DecisionEnv) {
  for (const k of DECISION_ENV_KEYS) process.env[k] = env[k] ?? BASE_ENV[k];
}

interface ScenarioReport {
  ok: boolean;
  failures: string[];
  [k: string]: unknown;
}

function summarize(r: DecideResult) {
  return {
    source: r.source,
    model: r.model ?? null,
    note: r.note ?? null,
    coverage: r.coverage,
    fallbackIds: r.fallbackIds,
    answers: Object.fromEntries(r.answers.map((a) => [a.id, a.value])),
  };
}

function check(failures: string[], cond: boolean, msg: string) {
  if (!cond) failures.push(msg);
}

const sameAnswer = (a: DecideAnswer | undefined, b: DecideAnswer) =>
  Boolean(a) && a!.type === b.type && a!.value === b.value;

// ---------------- 主程式 ----------------
async function main() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => sendJson(res, 500, { error: String(e) }));
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const STUB = `http://127.0.0.1:${port}`;
  const jevUrl = (scenario: string, behavior: string) => `${STUB}/jev/${scenario}/${behavior}`;
  const llmUrl = (scenario: string, behavior: string) => `${STUB}/llm/${scenario}/${behavior}`;
  const reqsOf = (scenario: string, tier?: "jev" | "llm") =>
    requests
      .filter((r) => r.scenario === scenario && (!tier || r.tier === tier))
      .map((r) => ({ tier: r.tier, questionIds: r.questionIds, hasAuth: r.hasAuth }));

  const ALL_IDS = QUESTIONS.map((q) => q.id);
  const scenarios: Record<string, ScenarioReport> = {};

  async function scenario(
    name: string,
    env: DecisionEnv,
    run: (failures: string[]) => Promise<Record<string, unknown>>,
  ) {
    applyEnv(env);
    _resetDecideState();
    const failures: string[] = [];
    let detail: Record<string, unknown> = {};
    try {
      detail = await run(failures);
    } catch (e) {
      failures.push(`threw: ${(e as Error)?.stack ?? e}`);
    }
    scenarios[name] = { ok: failures.length === 0, failures, ...detail };
    log(`${failures.length === 0 ? "✓" : "✗"} ${name}${failures.length ? `  ← ${failures.join("; ")}` : ""}`);
  }

  // ---- 0) 三段鏈順序（純 env 推導，不發請求） ----
  const chainOf = (env: DecisionEnv) => {
    applyEnv(env);
    return decisionChain().join(">");
  };
  const chains = {
    auto_both_keys: chainOf({ JEV_API_KEY: "k", LLM_API_KEY: "k" }),
    auto_no_keys: chainOf({}),
    auto_llm_only: chainOf({ LLM_API_KEY: "k" }),
    auto_jev_only: chainOf({ JEV_API_KEY: "k" }),
    fallback_mock_skips_llm: chainOf({ JEV_API_KEY: "k", LLM_API_KEY: "k", DECISION_FALLBACK: "mock" }),
    provider_jev_no_key: chainOf({ DECISION_PROVIDER: "jev" }),
    provider_mock: chainOf({ DECISION_PROVIDER: "mock", JEV_API_KEY: "k", LLM_API_KEY: "k" }),
  };
  const EXPECTED_CHAINS: Record<keyof typeof chains, string> = {
    auto_both_keys: "jev>llm>mock",
    auto_no_keys: "mock",
    auto_llm_only: "llm>mock",
    auto_jev_only: "jev>mock",
    fallback_mock_skips_llm: "jev>mock",
    provider_jev_no_key: "jev>mock",
    provider_mock: "mock",
  };
  // decide() 走到 mock 就停（mock 是最後一層），所以只比對「第一個 mock 以前（含）」的有效鏈；
  // 例：DECISION_PROVIDER=mock 且有 LLM key 時 decisionChain() 回 "mock>llm"，但 llm 永遠不會被呼叫。
  const effective = (c: string) => c.split(">").slice(0, c.split(">").indexOf("mock") + 1).join(">");
  const chainFailures = Object.entries(EXPECTED_CHAINS)
    .filter(([k, v]) => effective(chains[k as keyof typeof chains]) !== v)
    .map(([k, v]) => `${k}: got ${chains[k as keyof typeof chains]}, want ${v}`);
  log(`${chainFailures.length ? "✗" : "✓"} chains ${JSON.stringify(chains)}`);

  // ---- 1) 無 key：直接用規則，不發任何請求 ----
  await scenario("no_keys_rules", {}, async (f) => {
    const r = await decide({ state: STATE, questions: QUESTIONS, fallback });
    check(f, r.source === "mock", `source=${r.source}`);
    check(f, r.coverage.remote === 0 && r.coverage.fallbacks === QUESTIONS.length, "coverage");
    check(f, QUESTIONS.every((q) => sameAnswer(r.answers.find((a) => a.id === q.id), RULE[q.id])), "answers≠rules");
    return summarize(r);
  });

  // ---- 1b) DECISION_PROVIDER=mock：就算兩把 key 都有、位址指向 stub，也一個請求都不發 ----
  await scenario(
    "provider_mock_no_requests",
    {
      DECISION_PROVIDER: "mock",
      JEV_API_KEY: "stub-key",
      JEV_BASE_URL: jevUrl("provider_mock_no_requests", "ok"),
      LLM_API_KEY: "stub-llm-key",
      LLM_BASE_URL: llmUrl("provider_mock_no_requests", "ok"),
    },
    async (f) => {
      const r = await decide({ state: STATE, questions: QUESTIONS, fallback });
      const reqs = reqsOf("provider_mock_no_requests");
      check(f, r.source === "mock", `source=${r.source}`);
      check(f, reqs.length === 0, `stub 收到 ${reqs.length} 個請求`);
      return { ...summarize(r), requests: reqs };
    },
  );

  // ---- 2) Jev 連不上（黑洞）＋ 沒有 LLM key → 規則 ----
  await scenario("jev_unreachable_rules", { JEV_API_KEY: "stub-bad-key" }, async (f) => {
    const r = await decide({ state: STATE, questions: QUESTIONS, fallback });
    check(f, r.source === "mock", `source=${r.source}`);
    check(f, /jev_failed/.test(r.note ?? ""), `note=${r.note}`);
    check(f, !/llm_failed/.test(r.note ?? ""), "LLM 層不該在鏈上");
    return summarize(r);
  });

  // ---- 3) Jev 401 → LLM 接手（真正穿過三段鏈的中間層） ----
  await scenario(
    "jev_401_llm_ok",
    {
      JEV_API_KEY: "stub-bad-key",
      JEV_BASE_URL: jevUrl("jev_401_llm_ok", "401"),
      LLM_API_KEY: "stub-llm-key",
      LLM_BASE_URL: llmUrl("jev_401_llm_ok", "ok"),
    },
    async (f) => {
      const r = await decide({ state: STATE, questions: QUESTIONS, fallback });
      const reqs = reqsOf("jev_401_llm_ok");
      check(f, r.source === "llm", `source=${r.source}`);
      check(f, /jev_failed: HTTP 401/.test(r.note ?? ""), `note=${r.note}`);
      check(f, r.model === "llm-stub", `model=${r.model}`);
      check(f, r.coverage.remote === QUESTIONS.length && r.coverage.fallbacks === 0, "coverage");
      check(f, reqs.map((x) => x.tier).join(">") === "jev>llm", `requests=${reqs.map((x) => x.tier)}`);
      check(f, reqs.every((x) => x.hasAuth), "Authorization header 缺漏");
      return { ...summarize(r), requests: reqs };
    },
  );

  // ---- 4) Jev 401 → LLM 回壞 JSON → 規則 ----
  await scenario(
    "jev_401_llm_badjson_rules",
    {
      JEV_API_KEY: "stub-bad-key",
      JEV_BASE_URL: jevUrl("jev_401_llm_badjson_rules", "401"),
      LLM_API_KEY: "stub-llm-key",
      LLM_BASE_URL: llmUrl("jev_401_llm_badjson_rules", "badjson"),
    },
    async (f) => {
      const r = await decide({ state: STATE, questions: QUESTIONS, fallback });
      const reqs = reqsOf("jev_401_llm_badjson_rules");
      check(f, r.source === "mock", `source=${r.source}`);
      check(f, /jev_failed/.test(r.note ?? "") && /llm_failed/.test(r.note ?? ""), `note=${r.note}`);
      check(f, reqs.map((x) => x.tier).join(">") === "jev>llm", `requests=${reqs.map((x) => x.tier)}`);
      return { ...summarize(r), requests: reqs };
    },
  );

  // ---- 5) 覆蓋不足重試：第 1 次缺題 → 第 2 次只送缺漏題並補齊 ----
  await scenario(
    "coverage_retry",
    { JEV_API_KEY: "stub-key", JEV_BASE_URL: jevUrl("coverage_retry", "partial") },
    async (f) => {
      const r = await decide({ state: STATE, questions: QUESTIONS, fallback });
      const reqs = reqsOf("coverage_retry", "jev");
      check(f, r.source === "jev", `source=${r.source}`);
      check(f, r.coverage.retries === 1, `retries=${r.coverage.retries}`);
      check(f, r.coverage.fallbacks === 0 && r.coverage.remote === QUESTIONS.length, "coverage");
      check(f, reqs.length === 2, `jev requests=${reqs.length}`);
      check(f, reqs[0]?.questionIds.join(",") === ALL_IDS.join(","), "第 1 次應送全部題目");
      check(
        f,
        reqs[1]?.questionIds.join(",") === ALL_IDS.slice(1).join(","),
        `第 2 次應只送缺漏題，實際 ${reqs[1]?.questionIds}`,
      );
      return { ...summarize(r), requests: reqs };
    },
  );

  // ---- 6) 逐題 fallback：choice 題兩次都不合法 → 只有它退回規則 ----
  await scenario(
    "per_question_fallback",
    { JEV_API_KEY: "stub-key", JEV_BASE_URL: jevUrl("per_question_fallback", "invalid-choice") },
    async (f) => {
      const r = await decide({ state: STATE, questions: QUESTIONS, fallback });
      const reqs = reqsOf("per_question_fallback", "jev");
      check(f, r.source === "jev", `source=${r.source}`);
      check(f, r.fallbackIds.join(",") === "goal_same", `fallbackIds=${r.fallbackIds}`);
      check(f, r.coverage.fallbacks === 1 && r.coverage.remote === QUESTIONS.length - 1, "coverage");
      check(f, r.coverage.retries === 1, `retries=${r.coverage.retries}`);
      check(f, sameAnswer(r.answers.find((a) => a.id === "goal_same"), RULE.goal_same), "goal_same 應是規則答案");
      check(f, r.answers.find((a) => a.id === "skill_fit")?.value === 4, "skill_fit 應採用 Jev 答案");
      check(f, reqs[1]?.questionIds.join(",") === "goal_same", `重打應只送 goal_same，實際 ${reqs[1]?.questionIds}`);
      return { ...summarize(r), requests: reqs };
    },
  );

  // ---- 7) 斷路器：連續 3 次失敗 → 第 4 次不再打 Jev ----
  await scenario(
    "circuit_breaker",
    { JEV_API_KEY: "stub-key", JEV_BASE_URL: jevUrl("circuit_breaker", "500") },
    async (f) => {
      const notes: (string | null)[] = [];
      for (let i = 0; i < 3; i++) {
        const r = await decide({ state: STATE, questions: QUESTIONS, fallback });
        notes.push(r.note ?? null);
        check(f, r.source === "mock", `#${i + 1} source=${r.source}`);
        check(f, /jev_failed: HTTP 500/.test(r.note ?? ""), `#${i + 1} note=${r.note}`);
      }
      const stateAfter3 = jevBreaker.state();
      const fourth = await decide({ state: STATE, questions: QUESTIONS, fallback });
      notes.push(fourth.note ?? null);
      const jevCalls = reqsOf("circuit_breaker", "jev").length;
      check(f, stateAfter3 === "open", `breaker=${stateAfter3}`);
      check(f, fourth.source === "mock", `#4 source=${fourth.source}`);
      check(f, /jev_circuit_open/.test(fourth.note ?? ""), `#4 note=${fourth.note}`);
      check(f, jevCalls === 3, `Jev 收到 ${jevCalls} 個請求（斷路後不該再打）`);
      return {
        breakerAfter3: stateAfter3,
        consecutiveFailures: jevBreaker.consecutiveFailures(),
        jevRequests: jevCalls,
        notes,
        fourth: summarize(fourth),
      };
    },
  );

  // ---- 8) 逾時涵蓋讀 body：標頭已回、body 卡住 ----
  await scenario(
    "timeout_covers_body",
    {
      JEV_API_KEY: "stub-key",
      JEV_BASE_URL: jevUrl("timeout_covers_body", "slow-body"),
      JEV_TIMEOUT_MS: "400",
    },
    async (f) => {
      const t0 = Date.now();
      const r = await decide({ state: STATE, questions: QUESTIONS, fallback });
      const elapsedMs = Date.now() - t0;
      check(f, r.source === "mock", `source=${r.source}`);
      check(f, /jev_failed: timeout/.test(r.note ?? ""), `note=${r.note}`);
      check(f, elapsedMs < 2500, `耗時 ${elapsedMs}ms（應在逾時附近結束）`);
      return { ...summarize(r), elapsedMs };
    },
  );

  // ---- 9) hybrid 報告：現場設定（LLM_PROVIDER=hybrid + DECISION_PROVIDER=jev）的評分路徑 ----
  await scenario(
    "hybrid_report",
    {
      DECISION_PROVIDER: "jev",
      JEV_API_KEY: "stub-key",
      JEV_BASE_URL: jevUrl("hybrid_report", "ok"),
      LLM_API_KEY: "stub-llm-key",
      LLM_BASE_URL: llmUrl("hybrid_report", "ok"),
    },
    async (f) => {
      // llm/index.ts 在 import 時決定模式：先設好 env 再動態載入
      process.env.LLM_PROVIDER = "hybrid";
      const { llm, LLM_MODE } = await import("../src/lib/llm");
      const { DEMO_HACKER, HACK_PERSONAS } = await import("../src/lib/personas");
      const report = await llm.matchReport(
        DEMO_HACKER.profile,
        HACK_PERSONAS[3].profile,
        "",
        "verify-pair",
        undefined,
        "zh",
      );
      const jevReqs = reqsOf("hybrid_report", "jev");
      const dims = Object.values(report.dimensions ?? {});
      check(f, LLM_MODE === "hybrid", `LLM_MODE=${LLM_MODE}`);
      check(f, report.decisionSource === "jev", `decisionSource=${report.decisionSource}`);
      check(f, typeof report.ruleScore === "number", `ruleScore=${report.ruleScore}`);
      check(f, report.score >= 0 && report.score <= 100, `score=${report.score}`);
      check(f, dims.length === 5 && dims.every((d) => d >= 0 && d <= 100), `dimensions=${dims}`);
      check(
        f,
        report.decisionCoverage?.remote === report.decisionCoverage?.expected &&
          (report.decisionCoverage?.expected ?? 0) > 0,
        `decisionCoverage=${JSON.stringify(report.decisionCoverage)}`,
      );
      check(f, jevReqs.length === 1, `Jev 請求數=${jevReqs.length}`);
      check(f, reqsOf("hybrid_report", "llm").length === 0, "評分不該打 LLM");
      return {
        llmMode: LLM_MODE,
        decisionSource: report.decisionSource,
        decisionModel: report.decisionModel ?? null,
        score: report.score,
        ruleScore: report.ruleScore ?? null,
        decisionCoverage: report.decisionCoverage ?? null,
        fallbackCount: report.fallbackCount ?? null,
        jevRequests: jevReqs.length,
      };
    },
  );

  // ---- 收尾 ----
  for (const s of sockets) s.destroy();
  await new Promise<void>((r) => server.close(() => r()));
  _resetDecideState();

  const failed = Object.entries(scenarios).filter(([, s]) => !s.ok).map(([k]) => k);
  if (chainFailures.length) failed.unshift("chains");
  const out = {
    ok: failed.length === 0,
    failed,
    offline: true,
    stub: STUB,
    blackhole: BLACKHOLE,
    chains,
    chainFailures,
    scenarios,
    // stub 總共收到的請求數（其餘位址都是黑洞，連不上）
    stubRequests: requests.length,
  };
  log(out.ok ? "✅ verify-decision 全部通過" : `❌ verify-decision 失敗：${failed.join(", ")}`);
  console.log(`VERIFY_DECISION_JSON ${JSON.stringify(out)}`);
  process.exit(out.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
