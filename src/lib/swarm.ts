import { prisma } from "./db";

/**
 * 蜂群 Part 層（P0）：把每個工作單元變成有穩定 ID、固定 slot、可覆蓋檢查與重試的 Part。
 * 設計取自 EvoX 蜂群實驗一的結論：原子拆分 + 隔離執行 + 程式匯合。
 */

export const PAIR_PART_IDS = (runId: string) => [
  `q:${runId}:A`,
  `a:${runId}:B`,
  `q:${runId}:B`,
  `a:${runId}:A`,
  `r:${runId}:A`,
  `r:${runId}:B`,
];

export interface PartTrace {
  provider?: string;
  model?: string;
  inputTokens?: number;
  answers?: unknown;
  confidence?: number;
  retained?: boolean;
}

/** 執行一個 Part：pending → (失敗自動重試一次) → done/failed，全程寫入軌跡 */
export async function runPart<T>(
  opts: {
    id: string;
    kind: string;
    label?: string;
    runId?: string;
    teamId?: string;
  },
  fn: () => Promise<{ value: T; trace?: PartTrace }>,
): Promise<T> {
  await prisma.swarmPart.upsert({
    where: { id: opts.id },
    update: { status: "pending", note: null },
    create: {
      id: opts.id,
      kind: opts.kind,
      label: opts.label ?? "",
      runId: opts.runId ?? null,
      teamId: opts.teamId ?? null,
      status: "pending",
    },
  });

  const maxAttempts = 2; // part 級重試：1 次原始 + 1 次重試
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t0 = Date.now();
    try {
      const { value, trace } = await fn();
      await prisma.swarmPart.update({
        where: { id: opts.id },
        data: {
          status: "done",
          provider: trace?.provider ?? null,
          model: trace?.model ?? null,
          latencyMs: Date.now() - t0,
          inputTokens: trace?.inputTokens ?? null,
          confidence: trace?.confidence ?? null,
          retained: trace?.retained ?? null,
          answers: (trace?.answers as object) ?? undefined,
          retries: attempt - 1,
        },
      });
      return value;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        await prisma.swarmPart.update({
          where: { id: opts.id },
          data: { retries: attempt, note: `retry after: ${(e as Error).message}` },
        });
        continue;
      }
    }
  }

  await prisma.swarmPart.update({
    where: { id: opts.id },
    data: {
      status: "failed",
      retries: maxAttempts - 1,
      note: `failed: ${(lastErr as Error)?.message ?? "unknown"}`,
    },
  });
  throw lastErr;
}

export interface PartSummary {
  expected: number;
  done: number;
  failed: number;
  pending: number;
  retries: number;
  retainedPct: number | null; // 決策值原樣進入交付的比例（可量測者）
  providers: string[]; // 出現過的 provider（去重）
  avgLatencyMs: number | null;
}

/** 單一 run 的覆蓋統計（pair 工作預期 6 個 part） */
export function summarizeParts(
  runId: string,
  parts: { status: string; retries: number; retained: boolean | null; provider: string | null; latencyMs: number | null }[],
): PartSummary {
  const expected = PAIR_PART_IDS(runId).length;
  const mine = parts;
  const done = mine.filter((p) => p.status === "done").length;
  const failed = mine.filter((p) => p.status === "failed").length;
  const pending = Math.max(0, expected - mine.length);
  const retries = mine.reduce((a, p) => a + p.retries, 0);
  const measurable = mine.filter((p) => p.retained !== null);
  const retainedPct = measurable.length
    ? Math.round((measurable.filter((p) => p.retained).length / measurable.length) * 100)
    : null;
  const providers = Array.from(
    new Set(mine.map((p) => p.provider).filter(Boolean) as string[]),
  );
  const lat = mine.filter((p) => p.latencyMs !== null) as { latencyMs: number }[];
  const avgLatencyMs = lat.length
    ? Math.round(lat.reduce((a, p) => a + p.latencyMs, 0) / lat.length)
    : null;
  return { expected, done, failed, pending, retries, retainedPct, providers, avgLatencyMs };
}

/** 批次取得多個 run 的 part 明細 */
export async function partsByRun(runIds: string[]) {
  if (runIds.length === 0) return new Map<string, PartSummary>();
  const rows = await prisma.swarmPart.findMany({
    where: { runId: { in: runIds } },
    select: {
      id: true,
      runId: true,
      status: true,
      retries: true,
      retained: true,
      provider: true,
      latencyMs: true,
    },
  });
  const map = new Map<string, PartSummary>();
  for (const runId of runIds) {
    map.set(
      runId,
      summarizeParts(
        runId,
        rows.filter((r) => r.runId === runId),
      ),
    );
  }
  return map;
}
