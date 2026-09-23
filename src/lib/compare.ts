import { prisma } from "./db";
import type { HackathonProfile, MatchReport, RunEvent, VisibilityMap } from "./types";
import { profileFromRow, publicProfile } from "./profile";
import { LLM_MODE } from "./llm";
import { withMeter, type CallMeter } from "./llm/meter";
import * as real from "./llm/real";
import * as mock from "./llm/mock";

/**
 * 單體 vs 蜂群對照（SECTION 9 賽道要求：對比單一 Agent 與蜂群的質量/速度/成本取捨）
 *   蜂群 = 既有 run 的 6-Part 隔離執行（對談生成 4 Part + 雙方評分 2 Part）
 *   單體 = 沿用「蜂群已生成的同一份逐字稿」，一次呼叫直接產出 A 方報告（不重新生成對談）
 *
 * 公平比較請看 timing.scoringMs（蜂群 r:A 評分 Part vs 單體評分呼叫）；
 * timing.totalMs 的蜂群值含對談生成與 mock 模式的節奏延遲，和單體不是同一個範圍。
 * 評分 provider 可能不同（hybrid：蜂群評分走 Jev 決策層、單體走 LLM）→ 見 scoringSource。
 * 評分輸入對齊：蜂群 r:A 走決策層（Jev／LLM 決策／規則）時 state 只有雙方各 6 個欄位＋逐字稿前 6000 字
 * （mock.reportState），單體 LLM 也只給同樣 6 個欄位（realMatchReport 本身只取逐字稿前 6000 字）→ solo.extra.input。
 * 輸入相同、評分者仍不同，分差不能解讀為蜂群的品質優勢（/compare cmp.agreementNote 明講）。
 */

export interface SideMetrics {
  source: string; // jev | llm | mock（蜂群為決策層 provider 混合）
  /** 相容舊欄位：蜂群＝timing.totalMs（全流程牆鐘），單體＝timing.scoringMs */
  latencyMs: number | null;
  /** 實際嘗試次數（每個 Part／呼叫 = 1 + 重試；mock 也算一次） */
  calls: number;
  retries: number;
  score: number;
  verdict: MatchReport["verdict"];
  dimensions: MatchReport["dimensions"];
  reasons: number;
  redFlags: number;
  sharedTopics: number;
  fieldsFilled: number;
  fieldsExpected: number;
  /** 計時分段 */
  timing: {
    /** 蜂群：第一個到最後一個事件的牆鐘（含對談生成）；單體：等於 scoringMs */
    totalMs: number | null;
    /** 評分步驟：蜂群＝r:A Part 耗時（與單體可比）；單體＝那一次評分呼叫 */
    scoringMs: number | null;
    /** 對談生成（q/a 四個 Part）耗時總和；單體＝0（沿用蜂群逐字稿） */
    transcriptMs: number | null;
  };
  /** 呼叫數分列 */
  callBreakdown: {
    /** 對談生成的嘗試次數；單體＝0 */
    transcript: number;
    /** 評分步驟的嘗試次數（蜂群＝r:A＋r:B） */
    scoring: number;
    /** 與單體可比的評分嘗試次數（蜂群只算 r:A） */
    scoringComparable: number;
  };
  /** true＝這一側沒有自己生成對談，沿用蜂群的逐字稿（單體恆為 true） */
  reusesSwarmTranscript: boolean;
  /** 評分那一步實際的 provider（蜂群 r:A；單體 llm / mock） */
  scoringSource: string;
  /** token 用量（沒有 usage 時為 null） */
  tokens: { input: number | null; output: number | null };
  extra: Record<string, unknown>;
}

export interface CompareResult {
  runId: string;
  createdAt?: string;
  swarm: SideMetrics;
  solo: SideMetrics;
  agreement: { scoreDiff: number; dimAvgDiff: number };
}

const FIELDS_EXPECTED = 10; // 5 維度 + verdict + reasons + redFlags + sharedTopics + summary

/**
 * 決策層評分看得到的 6 個欄位（與 mock.reportState 的 me/them 相同），其他欄位清空、不帶 GitHub 驗證。
 * 單體 baseline 在蜂群 r:A 走決策層時用它，兩邊評分的輸入才相同。
 */
export function decisionFieldsOnly(p: HackathonProfile): HackathonProfile {
  return {
    nickname: p.nickname,
    role: p.role,
    skills: p.skills,
    goal: p.goal,
    availability: p.availability,
    workingStyle: p.workingStyle,
    timezone: "",
    vibe: "",
    dealbreakers: [],
    bio: "",
  };
}

/**
 * 蜂群 r:A 是否由決策層評分（輸入＝reportState 的 6 個欄位）：
 * real 模式的 realMatchReport 記 provider=real（完整公開檔案）；jev／llm（決策層的 LLM 退路）／mock（規則）都是決策層。
 * 沒有軌跡的舊 run 依目前模式判斷。
 */
export function swarmScoredByDecisionLayer(
  provider: string | null | undefined,
  mode: typeof LLM_MODE = LLM_MODE,
): boolean {
  return provider ? provider !== "real" : mode !== "real";
}

function fieldsFilled(r: MatchReport): number {
  const dims = Object.values(r.dimensions ?? {}).filter(
    (v) => typeof v === "number" && v > 0,
  ).length;
  return (
    dims +
    (r.verdict ? 1 : 0) +
    ((r.reasons?.length ?? 0) > 0 ? 1 : 0) +
    ((r.redFlags?.length ?? 0) > 0 ? 1 : 0) +
    ((r.sharedTopics?.length ?? 0) > 0 ? 1 : 0) +
    (r.summaryForUser ? 1 : 0)
  );
}

function qaTextFromEvents(events: unknown): string {
  const list = Array.isArray(events) ? (events as RunEvent[]) : [];
  // 事件順序即 A問/B答、B問/A答 交錯；以出現順序重建
  let out = "";
  for (const e of list) {
    if (e.type === "question") out += `${e.side}問：${e.text ?? ""}\n`;
    else if (e.type === "answer") out += `${e.side}答：${e.text ?? ""}\n`;
  }
  return out.trim();
}

const sumOrNull = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
const outputTokensOf = (note: string | null) => {
  const m = /outputTokens=(\d+)/.exec(note ?? "");
  return m ? Number(m[1]) : null;
};

export async function swarmMetricsForRun(runId: string): Promise<SideMetrics | null> {
  const run = await prisma.matchRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const report = run.reportA as unknown as MatchReport | null;
  if (!report) return null;

  // 蜂群牆鐘：第一個到最後一個事件的時間差（含對談生成；mock 模式另含每步 650ms 節奏延遲）
  const evList = Array.isArray(run.events) ? (run.events as RunEvent[]) : [];
  const tsList = evList
    .map((e) => (typeof e.ts === "number" ? e.ts : null))
    .filter((x): x is number => x !== null);
  const wallMs = tsList.length >= 2 ? Math.max(...tsList) - Math.min(...tsList) : null;

  const parts = await prisma.swarmPart.findMany({ where: { runId } });
  const done = parts.filter((p) => p.status === "done").length;
  const failed = parts.filter((p) => p.status === "failed").length;
  const retries = parts.reduce((a, p) => a + p.retries, 0);
  const attempts = (ps: typeof parts) => ps.reduce((a, p) => a + p.retries + 1, 0);
  const qaParts = parts.filter((p) => p.kind === "questions" || p.kind === "answers");
  const reportParts = parts.filter((p) => p.kind === "report");
  const rA = parts.find((p) => p.id === `r:${runId}:A`) ?? null;
  const measurable = parts.filter((p) => p.confidence !== null || p.provider);
  const lat = parts.filter((p) => p.latencyMs !== null) as { latencyMs: number }[];
  const totalLatency = lat.length
    ? lat.reduce((a, p) => a + p.latencyMs, 0)
    : null;
  const providers = Array.from(
    new Set(parts.map((p) => p.provider).filter(Boolean) as string[]),
  );

  return {
    source: report.decisionSource ?? (providers.join("+") || "unknown"),
    latencyMs: wallMs ?? totalLatency,
    calls: attempts(parts),
    retries,
    score: report.score,
    verdict: report.verdict,
    dimensions: report.dimensions,
    reasons: report.reasons?.length ?? 0,
    redFlags: report.redFlags?.length ?? 0,
    sharedTopics: report.sharedTopics?.length ?? 0,
    fieldsFilled: fieldsFilled(report),
    fieldsExpected: FIELDS_EXPECTED,
    timing: {
      totalMs: wallMs ?? totalLatency,
      scoringMs: rA?.latencyMs ?? null,
      transcriptMs: sumOrNull(qaParts.map((p) => p.latencyMs)),
    },
    callBreakdown: {
      transcript: attempts(qaParts),
      scoring: attempts(reportParts),
      scoringComparable: rA ? rA.retries + 1 : 0,
    },
    reusesSwarmTranscript: false,
    // real 模式的 r:A 就是 LLM（realMatchReport，與單體同一個評分者）→ 記成 llm，才不會誤判成「provider 不同」
    scoringSource:
      rA?.provider === "real" ? "llm" : (rA?.provider ?? report.decisionSource ?? "unknown"),
    tokens: {
      input: sumOrNull(parts.map((p) => p.inputTokens)),
      output: sumOrNull(parts.map((p) => outputTokensOf(p.note))),
    },
    extra: {
      expected: parts.length ? Math.max(parts.length, done + failed) : 0,
      done,
      failed,
      providers,
      avgLatencyMs: lat.length
        ? Math.round(totalLatency! / lat.length)
        : null,
      totalPartMs: totalLatency,
      wallMs,
      ruleScore: report.ruleScore ?? null,
      deltaVsRule:
        report.ruleScore !== undefined ? report.score - report.ruleScore : null,
      measurableParts: measurable.length,
      fallbackCount: report.fallbackCount ?? null,
      retention: report.retention ?? null,
    },
  };
}

/**
 * 舊版快取的單體結果沒有分段欄位：補上（舊版同樣是沿用蜂群逐字稿、單次評分）。
 * 舊版沒有 extra.input：LLM 單體當時看的是完整公開檔案（mock 單體一直只用 6 個欄位）。
 */
function normalizeSolo(m: SideMetrics): SideMetrics {
  const legacyInput = m.source?.startsWith("mock") ? "decision-fields" : "public-profile";
  return {
    ...m,
    extra: { ...m.extra, input: m.extra?.input ?? legacyInput },
    timing: m.timing ?? { totalMs: m.latencyMs, scoringMs: m.latencyMs, transcriptMs: 0 },
    callBreakdown: m.callBreakdown ?? {
      transcript: 0,
      scoring: m.calls,
      scoringComparable: m.calls,
    },
    reusesSwarmTranscript: true,
    scoringSource: m.scoringSource ?? m.source,
    tokens: m.tokens ?? { input: null, output: null },
  };
}

export async function runSoloBaseline(
  runId: string,
  opts?: { force?: boolean },
): Promise<CompareResult | null> {
  const run = await prisma.matchRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "completed") return null;

  const [a, b] = await Promise.all([
    prisma.user.findUnique({
      where: { id: run.userAId },
      include: { profile: true },
    }),
    prisma.user.findUnique({
      where: { id: run.userBId },
      include: { profile: true },
    }),
  ]);
  if (!a?.profile?.compiled || !b?.profile?.compiled) return null;

  const cached = await prisma.soloBaseline.findUnique({ where: { runId } });
  let solo: SideMetrics;

  if (cached && !opts?.force) {
    solo = normalizeSolo((cached.result as unknown as { metric: SideMetrics }).metric);
  } else {
    // 與蜂群同一套分享權限與 GitHub 驗證來源（matching.loadProfile）：
    // compiled.github 一律忽略、只注入 verification row，雙方都只用投影後的檔案
    const self = publicProfile(
      profileFromRow(a.profile.compiled, a.profile.verification),
      (a.profile.visibility as VisibilityMap) ?? null,
    );
    const other = publicProfile(
      profileFromRow(b.profile.compiled, b.profile.verification),
      (b.profile.visibility as VisibilityMap) ?? null,
    );
    const qa = qaTextFromEvents(run.events);
    // 跟著引擎模式走：LLM_PROVIDER=mock（或沒有 LLM key）就不外送
    const useLlm = LLM_MODE !== "mock";
    // 同輸入：蜂群 r:A 走決策層時只看雙方各 6 個欄位＋逐字稿前 6000 字，單體 LLM 也只給這 6 個欄位
    // （realMatchReport 只取逐字稿前 6000 字）；mock 的 mockMatchReport 本來就只用這 6 個欄位
    const rAPart = await prisma.swarmPart.findUnique({
      where: { id: `r:${runId}:A` },
      select: { provider: true },
    });
    const alignInput = useLlm && swarmScoredByDecisionLayer(rAPart?.provider);
    const t0 = Date.now();
    let report: MatchReport;
    let meter: CallMeter;
    try {
      ({ value: report, meter } = await withMeter(() =>
        useLlm
          ? real.realMatchReport(
              alignInput ? decisionFieldsOnly(self) : self,
              alignInput ? decisionFieldsOnly(other) : other,
              qa,
              `${runId}:solo`,
              runId,
            )
          : mock.mockMatchReport(self, other, qa, `${runId}:solo`),
      ));
    } catch (e) {
      console.error("[compare] solo baseline failed", e);
      return null;
    }
    const latencyMs = Date.now() - t0;
    const attempts = useLlm ? Math.max(1, meter.calls) : 1;
    const source = useLlm ? (LLM_MODE === "hybrid" ? "llm-single" : "llm") : "mock-single";
    solo = {
      source,
      latencyMs,
      calls: attempts,
      retries: attempts - 1,
      score: report.score,
      verdict: report.verdict,
      dimensions: report.dimensions,
      reasons: report.reasons?.length ?? 0,
      redFlags: report.redFlags?.length ?? 0,
      sharedTopics: report.sharedTopics?.length ?? 0,
      fieldsFilled: fieldsFilled(report),
      fieldsExpected: FIELDS_EXPECTED,
      timing: { totalMs: latencyMs, scoringMs: latencyMs, transcriptMs: 0 },
      callBreakdown: { transcript: 0, scoring: attempts, scoringComparable: attempts },
      reusesSwarmTranscript: true,
      scoringSource: useLlm ? "llm" : (report.decisionSource ?? "mock"),
      tokens: {
        input: meter.hasUsage ? meter.inputTokens : null,
        output: meter.hasUsage ? meter.outputTokens : null,
      },
      extra: {
        model: useLlm ? (process.env.LLM_MODEL ?? null) : null,
        // decision-fields：與蜂群決策層同樣的 6 個欄位＋逐字稿前 6000 字；public-profile：完整公開檔案
        input: alignInput || !useLlm ? "decision-fields" : "public-profile",
      },
    };
    await prisma.soloBaseline.upsert({
      where: { runId },
      update: { result: { metric: solo } as unknown as object },
      create: { runId, result: { metric: solo } as unknown as object },
    });
  }

  const swarm = await swarmMetricsForRun(runId);
  if (!swarm) return null;

  const dimKeys = ["interests", "values", "lifestyle", "communication", "intent"] as const;
  const diffs = dimKeys.map((k) =>
    Math.abs((swarm.dimensions[k] ?? 0) - (solo.dimensions[k] ?? 0)),
  );
  const agreement = {
    scoreDiff: Math.abs(swarm.score - solo.score),
    dimAvgDiff: Math.round((diffs.reduce((x, y) => x + y, 0) / dims(diffs)) * 10) / 10,
  };

  return {
    runId,
    createdAt: (cached && !opts?.force ? cached.createdAt : new Date()).toISOString(),
    swarm,
    solo,
    agreement,
  };
}

function dims(a: number[]): number {
  return Math.max(1, a.length);
}

export async function cachedComparison(runId: string): Promise<CompareResult | null> {
  const swarm = await swarmMetricsForRun(runId);
  if (!swarm) return null;
  const cached = await prisma.soloBaseline.findUnique({ where: { runId } });
  if (!cached) return null;
  const solo = normalizeSolo((cached.result as unknown as { metric: SideMetrics }).metric);
  const dimKeys = ["interests", "values", "lifestyle", "communication", "intent"] as const;
  const diffs = dimKeys.map((k) =>
    Math.abs((swarm.dimensions[k] ?? 0) - (solo.dimensions[k] ?? 0)),
  );
  return {
    runId,
    createdAt: cached.createdAt.toISOString(),
    swarm,
    solo,
    agreement: {
      scoreDiff: Math.abs(swarm.score - solo.score),
      dimAvgDiff:
        Math.round((diffs.reduce((x, y) => x + y, 0) / dims(diffs)) * 10) / 10,
    },
  };
}
