/**
 * 決策層（Decision Layer）：快速決策模型（Jev / TypeSafe System One）優先，
 * 失敗時依序退回 LLM 決策 → 本機規則，保證任何情況下都有答案。
 *
 *   decide({ state, questions, fallback }) 三段鏈：
 *     ├─ "jev"  → POST {JEV_BASE_URL}/systemone（Noul/Choice/Score 並行）
 *     ├─ "llm"  → 用既有 OpenAI 相容端點回答同一組決策題（JSON 模式）
 *     └─ "mock" → 呼叫端提供的本機規則答案（零延遲、不可失敗）
 *
 * 環境變數：
 *   DECISION_PROVIDER=auto|jev|mock   預設 auto（有 JEV_API_KEY 用 jev，否則由 fallback 鏈決定）
 *   DECISION_FALLBACK=auto|llm|mock   預設 auto（jev 失敗→llm→mock）；mock 表示不經 LLM
 *   JEV_API_KEY / JEV_MODEL=jev-latest / JEV_BASE_URL / JEV_TIMEOUT_MS=6000
 *   LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / DECISION_LLM_TIMEOUT_MS=20000
 */

export type DecideQuestion =
  | {
      id: string;
      type: "noul";
      instructions: string;
      criteria?: { true?: string; false?: string };
    }
  | {
      id: string;
      type: "choice";
      instructions: string;
      criteria: Record<string, string | null>;
    }
  | {
      id: string;
      type: "score";
      instructions: string;
      criteria: string[];
    };

export type DecideAnswer =
  | { id: string; type: "noul"; value: number }
  | {
      id: string;
      type: "choice";
      value: string;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | {
      id: string;
      type: "score";
      value: number;
      confidence: number;
      probabilities: Record<string, number>;
    };

export type DecideSource = "jev" | "llm" | "mock";

export interface DecideCoverage {
  expected: number; // 宣告的 part（題目）數
  filled: number; // 有答案的 part 數（永遠等於 expected：缺的會用規則補）
  remote: number; // 由遠端層（jev/llm）回答的 part 數
  fallbacks: number; // 逐題回退到規則的 part 數
  retries: number; // part 級重試次數（覆蓋不足時重打一次）
}

export interface DecideResult {
  answers: DecideAnswer[];
  source: DecideSource;
  model?: string;
  note?: string;
  inputTokens?: number;
  latencyMs?: number;
  coverage: DecideCoverage;
}

export interface DecideOptions {
  state: unknown;
  questions: DecideQuestion[];
  /** 本機規則：任何失敗情況都會用它補齊答案 */
  fallback: (q: DecideQuestion) => DecideAnswer;
  /** 覆寫起點 provider（測試或特定流程用） */
  provider?: DecideSource;
  sessionId?: string;
}

const JEV_BASE = () => process.env.JEV_BASE_URL || "https://api.typesafe.ai/v1";
const JEV_MODEL = () => process.env.JEV_MODEL || "jev-latest";
const JEV_TIMEOUT = () => Number(process.env.JEV_TIMEOUT_MS || 6000);
const JEV_KEY = () => process.env.JEV_API_KEY || "";

const LLM_BASE = () =>
  (process.env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const LLM_KEY = () => process.env.LLM_API_KEY || "";
const LLM_MODEL = () => process.env.LLM_MODEL || "deepseek-chat";
const LLM_TIMEOUT = () => Number(process.env.DECISION_LLM_TIMEOUT_MS || 20000);

/** Jev 連續失敗的簡易斷路器：60 秒內 3 次失敗就暫時跳過，避免每次白等逾時 */
const g = globalThis as unknown as { __jevFails?: number[] };
const jevFails: number[] = g.__jevFails ?? (g.__jevFails = []);
const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_THRESHOLD = 3;

function jevCircuitOpen(): boolean {
  const now = Date.now();
  while (jevFails.length && now - jevFails[0] > CIRCUIT_WINDOW_MS) jevFails.shift();
  return jevFails.length >= CIRCUIT_THRESHOLD;
}
function recordJevFailure() {
  jevFails.push(Date.now());
  if (jevFails.length > 10) jevFails.shift();
}

/** 依環境決定三段鏈順序（導出供測試與診斷） */
export function decisionChain(): DecideSource[] {
  const primary = (process.env.DECISION_PROVIDER || "auto").toLowerCase();
  const fallbackPref = (process.env.DECISION_FALLBACK || "auto").toLowerCase();
  const hasJev = Boolean(JEV_KEY());
  const hasLlm = Boolean(LLM_KEY());

  let chain: DecideSource[];
  if (primary === "mock") chain = ["mock"];
  else if (primary === "jev") chain = ["jev"];
  else chain = [hasJev ? "jev" : hasLlm ? "llm" : "mock"];

  if (fallbackPref === "mock") {
    if (!chain.includes("mock")) chain.push("mock");
    return chain;
  }
  if (hasLlm && !chain.includes("llm")) chain.push("llm");
  if (!chain.includes("mock")) chain.push("mock");
  return chain;
}

/** 本機規則答案全集 */
function fallbackAll(opts: DecideOptions): DecideAnswer[] {
  return opts.questions.map((q) => opts.fallback(q));
}

/** 把遠端回傳的 answers 逐題解析成型別安全答案；缺漏/型別不符 → 該題退回規則 */
function parseTyped(
  raw: Record<string, Record<string, unknown>>,
  opts: DecideOptions,
): { answers: DecideAnswer[]; remote: number; fallbacks: number } {
  let remote = 0;
  const answers = opts.questions.map((q) => {
    const a = raw[q.id];
    try {
      if (q.type === "noul" && typeof a?.noul === "number") {
        remote++;
        return { id: q.id, type: "noul" as const, value: a.noul as number };
      }
      if (
        q.type === "choice" &&
        typeof a?.choice === "string" &&
        (a.probabilities as object)
      ) {
        remote++;
        return {
          id: q.id,
          type: "choice" as const,
          value: a.choice as string,
          confidence: Number(a.confidence ?? 0),
          probabilities: (a.probabilities ?? {}) as Record<string, number>,
        };
      }
      if (q.type === "score" && typeof a?.score === "number") {
        remote++;
        return {
          id: q.id,
          type: "score" as const,
          value: a.score as number,
          confidence: Number(a.confidence ?? 0),
          probabilities: (a.probabilities ?? {}) as Record<string, number>,
        };
      }
    } catch {
      /* fallthrough */
    }
    return opts.fallback(q);
  });
  return { answers, remote, fallbacks: opts.questions.length - remote };
}

/** sessionId 會進 HTTP header：只保留可列印 ASCII，避免 ByteString 錯誤 */
function safeSid(s?: string): string | undefined {
  const v = (s ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  return v || undefined;
}

// ---------- Tier 1: Jev ----------
async function decideJev(opts: DecideOptions): Promise<DecideResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JEV_TIMEOUT());
  let res: Response;
  try {
    res = await fetch(`${JEV_BASE()}/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JEV_KEY()}`,
        "Content-Type": "application/json",
        ...(safeSid(opts.sessionId)
          ? { "x-opencode-session": safeSid(opts.sessionId)! }
          : {}),
      },
      body: JSON.stringify({
        model: JEV_MODEL(),
        state: opts.state,
        questions: Object.fromEntries(opts.questions.map((q) => [q.id, q])),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as {
    model?: string;
    answers?: Record<string, Record<string, unknown>>;
    usage?: { input_tokens?: number };
  };
  const parsed = parseTyped(data.answers ?? {}, opts);
  return {
    answers: parsed.answers,
    source: "jev",
    model: data.model,
    inputTokens: data.usage?.input_tokens,
    coverage: {
      expected: opts.questions.length,
      filled: opts.questions.length,
      remote: parsed.remote,
      fallbacks: parsed.fallbacks,
      retries: 0,
    },
  };
}

// ---------- Tier 2: LLM（同一組決策題、JSON 模式） ----------
const DECISION_SYSTEM = `You are a type-safe decision engine. You do NOT write prose, explanations or markdown.
You answer each question with a typed decision, in JSON only.

Question types:
- "noul": return {"noul": <number 0..1>} — the probability that the statement is true.
- "choice": return {"choice": "<one of the criteria keys>", "confidence": <0..1>, "probabilities": {"<key>": <0..1>, ...}}
- "score": return {"score": <number between 0 and criteria.length - 1, may be fractional>, "confidence": <0..1>, "probabilities": {"0": <0..1>, ...}}

Output shape (exactly):
{"answers": {"<question id>": <answer object>, ...}}
Answer every declared question id. Use the criteria descriptions as your rubric.`;

async function decideLlm(opts: DecideOptions): Promise<DecideResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT());
  let res: Response;
  try {
    res = await fetch(`${LLM_BASE()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LLM_KEY()}`,
        "Content-Type": "application/json",
        // OpenCode Go 等閘道要求穩定的 session header；一般端點會忽略
        "x-opencode-session": safeSid(opts.sessionId) ?? "decide-llm",
      },
      body: JSON.stringify({
        model: LLM_MODEL(),
        messages: [
          { role: "system", content: DECISION_SYSTEM },
          {
            role: "user",
            content: `STATE:\n${JSON.stringify(opts.state)}\n\nQUESTIONS:\n${JSON.stringify(
              opts.questions,
            )}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 3000,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`llm HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number };
  };
  const raw = data.choices?.[0]?.message?.content ?? "{}";
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as {
    answers?: Record<string, Record<string, unknown>>;
  };
  if (!parsed.answers) throw new Error("llm bad_response");
  const typed = parseTyped(parsed.answers, opts);
  return {
    answers: typed.answers,
    source: "llm",
    model: LLM_MODEL(),
    inputTokens: data.usage?.prompt_tokens,
    coverage: {
      expected: opts.questions.length,
      filled: opts.questions.length,
      remote: typed.remote,
      fallbacks: typed.fallbacks,
      retries: 0,
    },
  };
}

export async function decide(opts: DecideOptions): Promise<DecideResult> {
  const chain = opts.provider ? [opts.provider] : decisionChain();
  const notes: string[] = [];

  for (const tier of chain) {
    if (tier === "mock") break; // 最後一層，統一在下面處理
    if (tier === "jev" && jevCircuitOpen()) {
      notes.push("jev_circuit_open");
      continue;
    }
    try {
      const t0 = Date.now();
      let res: DecideResult | null = null;
      let retries = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        res = tier === "jev" ? await decideJev(opts) : await decideLlm(opts);
        // 覆蓋率不足（有題目逐題回退）→ 只針對這一層重打一次
        if (res.coverage.fallbacks === 0) break;
        retries++;
        console.warn(
          `[decide] ${tier} 覆蓋不足（${res.coverage.remote}/${res.coverage.expected}）→ part 級重試 ${retries}`,
        );
      }
      if (res) {
        res.latencyMs = Date.now() - t0;
        res.coverage.retries = retries;
        return res;
      }
    } catch (e) {
      const reason =
        (e as Error).name === "AbortError" ? "timeout" : (e as Error).message;
      if (tier === "jev") recordJevFailure();
      notes.push(`${tier}_failed: ${reason}`);
      console.warn(`[decide] ${tier} 不可用（${reason}）→ 下一層`);
    }
  }

  return {
    answers: fallbackAll(opts),
    source: "mock",
    note: notes.join(" | ") || undefined,
    coverage: {
      expected: opts.questions.length,
      filled: opts.questions.length,
      remote: 0,
      fallbacks: opts.questions.length,
      retries: 0,
    },
  };
}

/** 取答案小工具 */
export function num(answers: DecideAnswer[], id: string, dft = 0): number {
  const a = answers.find((x) => x.id === id);
  return a && a.type === "noul" ? a.value : dft;
}
export function scoreOf(answers: DecideAnswer[], id: string, dft = 0): number {
  const a = answers.find((x) => x.id === id);
  return a && a.type === "score" ? a.value : dft;
}
export function choiceOf(answers: DecideAnswer[], id: string, dft = ""): string {
  const a = answers.find((x) => x.id === id);
  return a && a.type === "choice" ? a.value : dft;
}
