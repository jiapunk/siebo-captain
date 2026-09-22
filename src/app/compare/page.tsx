"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { api, useMe } from "@/lib/client";
import type { MatchReport } from "@/lib/types";

interface RunRow {
  id: string;
  status: string;
  other: { name: string; emoji: string; isBot: boolean };
  myReport: MatchReport | null;
  createdAt: string;
}

interface SideMetrics {
  source: string;
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

interface CompareResult {
  runId: string;
  createdAt?: string;
  swarm: SideMetrics;
  solo: SideMetrics;
  agreement: { scoreDiff: number; dimAvgDiff: number };
}

const DIMS: [keyof MatchReport["dimensions"], string][] = [
  ["interests", "技能互補"],
  ["values", "目標一致"],
  ["lifestyle", "投入程度"],
  ["communication", "協作風格"],
  ["intent", "靠譜度"],
];

export default function ComparePage() {
  const { me, loading } = useMe();
  const router = useRouter();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [runId, setRunId] = useState("");
  const [data, setData] = useState<CompareResult | null>(null);
  const [swarmOnly, setSwarmOnly] = useState<SideMetrics | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !me) router.replace("/");
  }, [me, loading, router]);

  useEffect(() => {
    if (!me) return;
    api<{ runs: RunRow[] }>("/api/agent/runs")
      .then((d) => {
        const done = d.runs.filter((r) => r.status === "completed");
        setRuns(done);
        if (done[0]) setRunId(done[0].id);
      })
      .catch(() => {});
  }, [me]);

  const load = useCallback(async (id: string) => {
    setErr(null);
    setData(null);
    setSwarmOnly(null);
    if (!id) return;
    try {
      const d = await api<{ comparison: CompareResult | null; swarm?: SideMetrics }>(
        `/api/compare?runId=${id}`,
      );
      if (d.comparison) setData(d.comparison);
      else if (d.swarm) setSwarmOnly(d.swarm);
    } catch {
      /* 尚未有 run */
    }
  }, []);

  useEffect(() => {
    load(runId);
  }, [runId, load]);

  async function runSolo(force = false) {
    if (!runId) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await api<{ comparison: CompareResult }>("/api/compare", {
        method: "POST",
        body: JSON.stringify({ runId, force }),
      });
      setData(d.comparison);
      setSwarmOnly(null);
    } catch {
      setErr("單體對照執行失敗（檢查 LLM 金鑰或稍後再試）");
    } finally {
      setBusy(false);
    }
  }

  if (!me)
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 items-center justify-center p-8 text-muted">
          {loading ? "載入中…" : "請先選擇身分"}
        </main>
      </>
    );

  const swarm = data?.swarm ?? swarmOnly;
  const solo = data?.solo ?? null;
  const selected = runs.find((r) => r.id === runId);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl flex-1 px-4 pb-16">
        <div className="mt-8">
          <div className="tag mb-2">SECTION 9 {"// "}單體 vs 蜂群</div>
          <h1 className="font-display text-xl font-bold">
            單體 vs 蜂群對照
          </h1>
          <p className="mt-1 text-sm text-muted">
            同一個對盤紀錄：<b>蜂群</b>＝6 個隔離 Part＋決策層（可重試）；
            <b>單體</b>＝一次 LLM 呼叫直接產出報告（無隔離、無法重試）。
          </p>
        </div>

        {/* 選擇 run */}
        <div className="card mt-4 p-4">
          <div className="mb-2 text-xs font-bold text-muted">
            選擇一場已完成的對盤
          </div>
          <div className="flex flex-wrap gap-2">
            {runs.slice(0, 8).map((r) => (
              <button
                key={r.id}
                onClick={() => setRunId(r.id)}
                className={`chip ${runId === r.id ? "chip-on" : ""}`}
              >
                {r.other.emoji} {r.other.name} · {r.myReport?.score ?? "-"}
              </button>
            ))}
            {runs.length === 0 && (
              <span className="text-xs text-muted">
                尚無完成的對盤——先到指揮台派隊長出擊
              </span>
            )}
          </div>
        </div>

        {runId && (
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => runSolo(false)}
              disabled={busy}
              className="btn btn-accent px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {busy
                ? "單體報告生成中…"
                : solo
                  ? "重新執行單體對照"
                  : "執行單體對照（1 次 LLM 呼叫）"}
            </button>
            {err && <span className="text-xs text-alert">{err}</span>}
          </div>
        )}

        {swarm && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <SideCard
              title="蜂群"
              subtitle={`${Number(swarm.extra.done ?? 0)}/${Number(swarm.extra.expected ?? swarm.calls)} Part · 決策層 ${String(swarm.source).toUpperCase()}`}
              metric={swarm}
              accent
            />
            {solo ? (
              <SideCard
                title="單體"
                subtitle={`1 次呼叫 · ${String(solo.source).toUpperCase()}`}
                metric={solo}
              />
            ) : (
              <div className="card cut flex items-center justify-center p-6 text-center text-xs text-muted">
                尚未執行單體 baseline
                <br />
                （按上方按鈕跑一次）
              </div>
            )}
          </div>
        )}

        {data && (
          <>
            <div className="card mt-4 p-5">
              <div className="mb-3 text-sm font-bold">取捨對照表</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2 font-normal">指標</th>
                    <th className="pb-2 font-normal">蜂群 6-Part</th>
                    <th className="pb-2 font-normal">單體 1-Call</th>
                  </tr>
                </thead>
                <tbody className="mono text-[13px]">
                  <Row label="呼叫數" a={String(data.swarm.calls)} b={String(data.solo.calls)} />
                  <Row label="重試" a={String(data.swarm.retries)} b={String(data.solo.retries)} />
                  <Row
                    label="牆鐘延遲"
                    a={data.swarm.latencyMs !== null ? `${(data.swarm.latencyMs / 1000).toFixed(1)}s` : "—"}
                    b={data.solo.latencyMs !== null ? `${(data.solo.latencyMs / 1000).toFixed(1)}s` : "—"}
                  />
                  <Row
                    label="累計 Part 工時"
                    a={
                      data.swarm.extra.totalPartMs
                        ? `${(Number(data.swarm.extra.totalPartMs) / 1000).toFixed(1)}s`
                        : "—"
                    }
                    b="—（無隔離）"
                  />
                  <Row
                    label="報告欄位完整度"
                    a={`${data.swarm.fieldsFilled}/${data.swarm.fieldsExpected}`}
                    b={`${data.solo.fieldsFilled}/${data.solo.fieldsExpected}`}
                  />
                  <Row
                    label="分數"
                    a={`${data.swarm.score}（${String(data.swarm.source).toUpperCase()}）`}
                    b={`${data.solo.score}（${String(data.solo.source).toUpperCase()}）`}
                  />
                  <Row
                    label="vs 規則層"
                    a={
                      data.swarm.extra.deltaVsRule !== null &&
                      data.swarm.extra.deltaVsRule !== undefined
                        ? `${Number(data.swarm.extra.deltaVsRule) >= 0 ? "+" : ""}${data.swarm.extra.deltaVsRule}`
                        : "—"
                    }
                    b="—"
                  />
                  <Row
                    label="失敗韌性"
                    a={`${data.swarm.extra.failed ?? 0} 失敗 · ${data.swarm.retries} 次重試吸收`}
                    b="單點失敗＝整份重跑"
                  />
                </tbody>
              </table>
              <div className="mono mt-4 text-xs text-muted">
                兩者一致性：分數差{" "}
                <span className="text-accent">{data.agreement.scoreDiff}</span> ·
                五維平均差{" "}
                <span className="text-accent">{data.agreement.dimAvgDiff}</span>
                （差距＝蜂群多讀到的訊號）
              </div>
            </div>

            <div className="card mt-4 p-5">
              <div className="mb-3 text-sm font-bold">五維對照</div>
              {DIMS.map(([k, label]) => (
                <div key={k} className="mb-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted">{label}</span>
                    <span className="mono">
                      {data.swarm.dimensions[k]} vs {data.solo.dimensions[k]}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${data.swarm.dimensions[k]}%` }}
                      />
                    </div>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-ink/40"
                        style={{ width: `${data.solo.dimensions[k]}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <div className="mt-2 text-[11px] text-muted">
                上排＝蜂群（{" "}
                <span className="text-accent">■</span>）· 下排＝單體（
                <span className="text-ink/60">■</span>）
                {selected && ` · ${selected.other.emoji} ${selected.other.name}`}
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}

function SideCard({
  title,
  subtitle,
  metric,
  accent,
}: {
  title: string;
  subtitle: string;
  metric: SideMetrics;
  accent?: boolean;
}) {
  return (
    <div className={`card cut p-4 ${accent ? "border-accent/50" : ""}`}>
      <div className="flex items-baseline justify-between">
        <span className={`font-display text-lg font-bold ${accent ? "text-accent" : ""}`}>
          {title}
        </span>
        <span className="mono text-[10px] text-muted">{subtitle}</span>
      </div>
      <div className="mono mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          分數 <span className="text-base font-bold">{metric.score}</span>
        </div>
        <div>
          理由/風險 <span className="text-base font-bold">{metric.reasons}/{metric.redFlags}</span>
        </div>
        <div>
          欄位 <span className="font-bold">{metric.fieldsFilled}/{metric.fieldsExpected}</span>
        </div>
        <div>
          延遲{" "}
          <span className="font-bold">
            {metric.latencyMs !== null ? `${metric.latencyMs}ms` : "—"}
          </span>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted">
        verdict: <span className="mono">{metric.verdict}</span>
        {metric.extra.providers ? (
          <> · providers: <span className="mono">{String((metric.extra.providers as string[]).join("+"))}</span></>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr className="border-t border-line">
      <td className="py-2 font-sans text-xs text-muted">{label}</td>
      <td className="py-2 text-accent">{a}</td>
      <td className="py-2 text-ink-soft">{b}</td>
    </tr>
  );
}
