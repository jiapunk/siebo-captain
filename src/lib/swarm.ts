import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { emptyMeter, mergeMeter, withMeterSettled } from "./llm/meter";

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

/** Part 生命週期事件（即時蜂群面板用；透過 bus 廣播） */
export interface PartLifecycleEvent {
  partId: string;
  kind: string;
  label: string;
  phase: "pending" | "running" | "retry" | "done" | "failed";
  attempt?: number;
  provider?: string | null;
  latencyMs?: number;
  /** 總重試次數 = Part 級重試 + real.ts／decide 內部重試（實際發出的請求才算） */
  retries?: number;
  /** 實際發出的 HTTP 請求數（mock＝0） */
  calls?: number;
  /** true＝遠端全部失敗後改用本機腳本產生（provider 會是 mock） */
  fallback?: boolean;
  error?: string;
}

export interface PartTrace {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  answers?: unknown;
  confidence?: number;
  retained?: boolean;
  /** 這次結果本身就是本機退路產生的（例如本場已降級，直接用本機腳本） */
  fallback?: boolean;
  /** 附加在 SwarmPart.note 的說明 */
  note?: string;
}

/** runPartDetailed 的執行摘要（寫進 SwarmPart，也回給呼叫端） */
export interface PartMeta {
  /** Part 級嘗試次數（1 或 2；fallback 不算） */
  attempts: number;
  /** 所有嘗試加總的實際 HTTP 請求數（mock＝0） */
  calls: number;
  /** 寫進 SwarmPart.retries 的總重試次數 */
  retries: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** 成功那一次（或 fallback）的耗時 */
  latencyMs: number;
  /** 含失敗嘗試的總耗時 */
  totalMs: number;
  fallback: boolean;
  provider: string | null;
}

export interface RunPartOptions<T> {
  id: string;
  kind: string;
  label?: string;
  runId?: string;
  teamId?: string;
  notify?: (ev: PartLifecycleEvent) => void;
  /** demo 用：第一次嘗試強制失敗，展示「成員失效 → 重試接力」 */
  faultOnce?: boolean;
  /** 回傳值驗證：throw 代表這次嘗試失敗（會重試），避免「先標 done 才崩潰」 */
  validate?: (value: T) => void;
  /** 所有嘗試都失敗後的本機退路（不外送、不可失敗）；有給就不會 throw */
  fallback?: () => Promise<{ value: T; trace?: PartTrace }>;
}

const errMsg = (e: unknown) => ((e as Error)?.message ?? String(e)).slice(0, 300);

/** 執行一個 Part：pending → (失敗自動重試一次) → done / fallback / failed，全程寫入軌跡 */
export async function runPart<T>(
  opts: RunPartOptions<T>,
  fn: () => Promise<{ value: T; trace?: PartTrace }>,
): Promise<T> {
  return (await runPartDetailed(opts, fn)).value;
}

export async function runPartDetailed<T>(
  opts: RunPartOptions<T>,
  fn: () => Promise<{ value: T; trace?: PartTrace }>,
): Promise<{ value: T; meta: PartMeta; trace?: PartTrace }> {
  const label = opts.label ?? "";
  // 同一個穩定 ID 重跑時把上一輪的軌跡清乾淨（避免殘留 provider/retries/answers）
  await prisma.swarmPart.upsert({
    where: { id: opts.id },
    update: {
      kind: opts.kind,
      label,
      runId: opts.runId ?? null,
      teamId: opts.teamId ?? null,
      status: "pending",
      provider: null,
      model: null,
      latencyMs: null,
      inputTokens: null,
      retries: 0,
      confidence: null,
      retained: null,
      answers: Prisma.DbNull,
      note: null,
    },
    create: {
      id: opts.id,
      kind: opts.kind,
      label,
      runId: opts.runId ?? null,
      teamId: opts.teamId ?? null,
      status: "pending",
    },
  });
  const base = { partId: opts.id, kind: opts.kind, label };
  opts.notify?.({ ...base, phase: "pending" });

  const maxAttempts = 2; // part 級重試：1 次原始 + 1 次重試
  const total = emptyMeter();
  const tStart = Date.now();
  let lastErr: unknown;

  const finish = async (
    value: T,
    trace: PartTrace | undefined,
    attempts: number,
    t0: number,
    fallbackRun: boolean,
  ) => {
    const fallback = fallbackRun || Boolean(trace?.fallback);
    const latencyMs = Date.now() - t0;
    const retries = attempts - 1 + total.retries;
    const inputTokens = total.hasUsage ? total.inputTokens : (trace?.inputTokens ?? null);
    const outputTokens = total.hasUsage ? total.outputTokens : (trace?.outputTokens ?? null);
    const provider = trace?.provider ?? null;
    const note = [
      fallbackRun
        ? `fallback=local after: ${errMsg(lastErr)}`
        : trace?.fallback
          ? `fallback=local: ${trace.note ?? "local script"}`
          : (trace?.note ?? null),
      `attempts=${attempts} calls=${total.calls}`,
      outputTokens !== null ? `outputTokens=${outputTokens}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    // DB 寫入失敗不重跑付費的 fn：記 log 即可，值照樣回傳
    try {
      await prisma.swarmPart.update({
        where: { id: opts.id },
        data: {
          status: "done",
          provider,
          model: trace?.model ?? null,
          latencyMs,
          inputTokens,
          confidence: trace?.confidence ?? null,
          retained: trace?.retained ?? null,
          answers: (trace?.answers as object) ?? undefined,
          retries,
          note,
        },
      });
    } catch (e) {
      console.error(`[swarm] part ${opts.id} trace write failed`, e);
    }
    opts.notify?.({
      ...base,
      phase: "done",
      attempt: attempts,
      provider,
      latencyMs,
      retries,
      calls: total.calls,
      fallback,
    });
    const meta: PartMeta = {
      attempts,
      calls: total.calls,
      retries,
      inputTokens,
      outputTokens,
      latencyMs,
      totalMs: Date.now() - tStart,
      fallback,
      provider,
    };
    return { value, meta, trace };
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const t0 = Date.now();
    opts.notify?.({ ...base, phase: "running", attempt });
    const r = await withMeterSettled(async () => {
      if (opts.faultOnce && attempt === 1)
        throw new Error("fault_injection_demo: simulated part failure");
      const out = await fn();
      opts.validate?.(out.value);
      return out;
    });
    mergeMeter(total, r.meter);
    if (r.ok) return finish(r.value.value, r.value.trace, attempt, t0, false);

    lastErr = r.error;
    if (attempt < maxAttempts) {
      opts.notify?.({ ...base, phase: "retry", attempt, error: errMsg(r.error) });
      await prisma.swarmPart
        .update({
          where: { id: opts.id },
          data: { retries: attempt, note: `retry after: ${errMsg(r.error)}` },
        })
        .catch(() => {});
    }
  }

  if (opts.fallback) {
    const t0 = Date.now();
    try {
      const out = await opts.fallback();
      opts.validate?.(out.value);
      return finish(out.value, out.trace, maxAttempts, t0, true);
    } catch (e) {
      console.error(`[swarm] part ${opts.id} local fallback failed`, e);
    }
  }

  await prisma.swarmPart
    .update({
      where: { id: opts.id },
      data: {
        status: "failed",
        retries: maxAttempts - 1 + total.retries,
        note: `failed: ${errMsg(lastErr)} · attempts=${maxAttempts} calls=${total.calls}`,
      },
    })
    .catch(() => {});
  opts.notify?.({
    ...base,
    phase: "failed",
    retries: maxAttempts - 1 + total.retries,
    calls: total.calls,
    error: errMsg(lastErr ?? "unknown"),
  });
  throw lastErr;
}

export interface PartSummary {
  expected: number;
  done: number;
  failed: number;
  pending: number;
  retries: number;
  /** 遠端失敗後改用本機腳本完成的 part 數 */
  fallbacks: number;
  retainedPct: number | null; // 決策值原樣進入交付的比例（可量測者：報告 part 的 RETAIN 量測）
  providers: string[]; // 出現過的 provider（去重）
  avgLatencyMs: number | null;
}

/** 單一 run 的覆蓋統計（pair 工作預期 6 個 part） */
export function summarizeParts(
  runId: string,
  parts: {
    status: string;
    retries: number;
    retained: boolean | null;
    provider: string | null;
    latencyMs: number | null;
    note?: string | null;
  }[],
): PartSummary {
  const expected = PAIR_PART_IDS(runId).length;
  const mine = parts;
  const done = mine.filter((p) => p.status === "done").length;
  const failed = mine.filter((p) => p.status === "failed").length;
  const pending = Math.max(0, expected - mine.length);
  const retries = mine.reduce((a, p) => a + p.retries, 0);
  const fallbacks = mine.filter((p) => (p.note ?? "").startsWith("fallback=")).length;
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
  return { expected, done, failed, pending, retries, fallbacks, retainedPct, providers, avgLatencyMs };
}

/** 批次取得多個 run 的 part 明細 */
export interface PartRow {
  id: string;
  kind: string;
  label: string;
  status: string;
  provider: string | null;
  latencyMs: number | null;
  retries: number;
}

/** 逐 Part 原始列（供前端回填蜂群面板；bus 即時事件優先） */
export async function partRowsByRun(
  runIds: string[],
): Promise<Map<string, PartRow[]>> {
  const map = new Map<string, PartRow[]>();
  if (runIds.length === 0) return map;
  const rows = await prisma.swarmPart.findMany({
    where: { runId: { in: runIds } },
    select: {
      id: true,
      runId: true,
      kind: true,
      label: true,
      status: true,
      provider: true,
      latencyMs: true,
      retries: true,
    },
    orderBy: { id: "asc" },
  });
  for (const runId of runIds) map.set(runId, []);
  for (const r of rows) {
    const list = map.get(r.runId ?? "");
    if (list)
      list.push({
        id: r.id,
        kind: r.kind,
        label: r.label,
        status: r.status,
        provider: r.provider,
        latencyMs: r.latencyMs,
        retries: r.retries,
      });
  }
  return map;
}

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
      note: true,
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
