import { prisma } from "./db";
import type { HackathonProfile, MatchReport, RunEvent } from "./types";
import { publicProfile } from "./profile";
import * as real from "./llm/real";
import * as mock from "./llm/mock";

/**
 * 單體 vs 蜂群對照（SECTION 9 賽道要求：對比單一 Agent 與蜂群的質量/速度/成本取捨）
 *   蜂群 = 既有 run 的 6-Part 隔離執行（覆蓋率、保留率、重試、延遲）
 *   單體 = 同一對話紀錄，一次 LLM 呼叫直接產出報告（無隔離、無重試）
 */

export interface SideMetrics {
  source: string; // jev | llm | mock（蜂群為決策層 provider 混合）
  latencyMs: number | null;
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
  const qs = list.filter((e) => e.type === "question") as Extract<
    RunEvent,
    { type: "question" }
  >[];
  const as = list.filter((e) => e.type === "answer") as Extract<
    RunEvent,
    { type: "answer" }
  >[];
  // 事件順序即 A問/B答、B問/A答 交錯；以出現順序重建
  let out = "";
  let qi = 0;
  let ai = 0;
  for (const e of list) {
    if (e.type === "question") {
      out += `${e.side}問：${qs[qi]?.text ?? ""}\n`;
      qi++;
    } else if (e.type === "answer") {
      out += `${e.side}答：${as[ai]?.text ?? ""}\n`;
      ai++;
    }
  }
  return out.trim();
}

export async function swarmMetricsForRun(runId: string): Promise<SideMetrics | null> {
  const run = await prisma.matchRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const report = run.reportA as unknown as MatchReport | null;
  if (!report) return null;

  // 蜂群牆鐘：第一個到最後一個事件的時間差（與單體可比較）
  const evList = Array.isArray(run.events) ? (run.events as RunEvent[]) : [];
  const tsList = evList
    .map((e) => (typeof e.ts === "number" ? e.ts : null))
    .filter((x): x is number => x !== null);
  const wallMs = tsList.length >= 2 ? Math.max(...tsList) - Math.min(...tsList) : null;

  const parts = await prisma.swarmPart.findMany({ where: { runId } });
  const done = parts.filter((p) => p.status === "done").length;
  const failed = parts.filter((p) => p.status === "failed").length;
  const retries = parts.reduce((a, p) => a + p.retries, 0);
  const measurable = parts.filter((p) => p.confidence !== null || p.provider);
  const lat = parts.filter((p) => p.latencyMs !== null) as { latencyMs: number }[];
  const totalLatency = lat.length
    ? lat.reduce((a, p) => a + p.latencyMs, 0)
    : null;
  const providers = Array.from(
    new Set(parts.map((p) => p.provider).filter(Boolean) as string[]),
  );

  return {
    source: report.decisionSource ?? providers.join("+") ?? "unknown",
    latencyMs: wallMs ?? totalLatency,
    calls: parts.length,
    retries,
    score: report.score,
    verdict: report.verdict,
    dimensions: report.dimensions,
    reasons: report.reasons?.length ?? 0,
    redFlags: report.redFlags?.length ?? 0,
    sharedTopics: report.sharedTopics?.length ?? 0,
    fieldsFilled: fieldsFilled(report),
    fieldsExpected: FIELDS_EXPECTED,
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
    },
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
    solo = (cached.result as unknown as { metric: SideMetrics }).metric;
  } else {
    const self = a.profile.compiled as unknown as HackathonProfile;
    const other = publicProfile(
      b.profile.compiled as unknown as HackathonProfile,
      b.profile.visibility as never,
    );
    const qa = qaTextFromEvents(run.events);
    const hasLlm = Boolean(process.env.LLM_API_KEY);
    const t0 = Date.now();
    const report = hasLlm
      ? await real.realMatchReport(self, other, qa, `${runId}:solo`, runId)
      : await mock.mockMatchReport(self, other, qa, `${runId}:solo`);
    const latencyMs = Date.now() - t0;
    solo = {
      source: hasLlm ? (process.env.LLM_PROVIDER === "hybrid" ? "llm-single" : "llm") : "mock-single",
      latencyMs,
      calls: 1,
      retries: 0,
      score: report.score,
      verdict: report.verdict,
      dimensions: report.dimensions,
      reasons: report.reasons?.length ?? 0,
      redFlags: report.redFlags?.length ?? 0,
      sharedTopics: report.sharedTopics?.length ?? 0,
      fieldsFilled: fieldsFilled(report),
      fieldsExpected: FIELDS_EXPECTED,
      extra: { model: report.decisionModel ?? process.env.LLM_MODEL ?? null },
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
    createdAt: (cached?.createdAt ?? new Date()).toISOString(),
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
  const solo = (cached.result as unknown as { metric: SideMetrics }).metric;
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
