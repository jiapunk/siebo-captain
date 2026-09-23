"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { api, apiErrorText, isAbortError, useMe } from "@/lib/client";
import { useI18n } from "@/lib/i18n";
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
  /** 計時分段：totalMs＝全流程牆鐘；scoringMs＝評分步驟（兩側可比）；transcriptMs＝對談生成 */
  timing?: { totalMs: number | null; scoringMs: number | null; transcriptMs: number | null };
  callBreakdown?: { transcript: number; scoring: number; scoringComparable: number };
  /** true＝沒有自己生成對談，沿用蜂群逐字稿（單體恆為 true） */
  reusesSwarmTranscript?: boolean;
  scoringSource?: string;
  tokens?: { input: number | null; output: number | null };
  extra: Record<string, unknown>;
}

interface CompareResult {
  runId: string;
  createdAt?: string;
  swarm: SideMetrics;
  solo: SideMetrics;
  agreement: { scoreDiff: number; dimAvgDiff: number };
}

type ViewerSide = "A" | "B";

/** 以 runId 為鍵快取：切換對盤時舊請求的結果只會寫進自己那一格，不會套到新選擇上 */
interface Loaded {
  comparison: CompareResult | null;
  swarm: SideMetrics | null;
  viewerSide: ViewerSide | null;
}

const DIM_KEYS: [keyof MatchReport["dimensions"], string][] = [
  ["interests", "rs.d1"],
  ["values", "rs.d2"],
  ["lifestyle", "rs.d3"],
  ["communication", "rs.d4"],
  ["intent", "rs.d5"],
];

const fmtS = (ms: number | null | undefined) =>
  typeof ms !== "number" || !Number.isFinite(ms)
    ? "—"
    : ms < 1000
      ? `${Math.round(ms)}ms`
      : `${(ms / 1000).toFixed(1)}s`;
const fmtN = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "—";
const upper = (s: string | null | undefined) => (s ? String(s).toUpperCase() : "—");

export default function ComparePage() {
  const { me, loading } = useMe();
  const { t } = useI18n();
  const router = useRouter();
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Loaded>>({});
  const [loadErr, setLoadErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [soloErr, setSoloErr] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!loading && !me) router.replace("/");
  }, [me, loading, router]);

  useEffect(() => {
    if (!me) return;
    api<{ runs: RunRow[] }>("/api/agent/runs")
      .then((d) => setRuns(d.runs.filter((r) => r.status === "completed")))
      .catch(() => setRuns([]));
  }, [me]);

  const runId = picked ?? runs?.[0]?.id ?? "";
  const haveResult = Boolean(runId && results[runId]);

  // 讀取已快取的對照；切換時中止上一個請求
  useEffect(() => {
    if (!runId || haveResult) return;
    const ac = new AbortController();
    api<{
      comparison: CompareResult | null;
      swarm?: SideMetrics;
      viewerSide?: ViewerSide;
    }>(`/api/compare?runId=${encodeURIComponent(runId)}`, { signal: ac.signal })
      .then((d) => {
        setResults((prev) => ({
          ...prev,
          [runId]: {
            comparison: d.comparison ?? null,
            swarm: d.swarm ?? null,
            viewerSide: d.viewerSide ?? null,
          },
        }));
        setLoadErr((prev) => {
          const { [runId]: _drop, ...rest } = prev;
          return rest;
        });
      })
      .catch((e) => {
        if (isAbortError(e)) return;
        setLoadErr((prev) => ({ ...prev, [runId]: apiErrorText(e, t, "cmp.loadErr") }));
      });
    return () => ac.abort();
  }, [runId, haveResult, t]);

  async function runSolo(id: string, force: boolean) {
    if (!id || busy[id]) return;
    setBusy((prev) => ({ ...prev, [id]: true }));
    setSoloErr((prev) => {
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
    try {
      const d = await api<{ comparison: CompareResult; viewerSide?: ViewerSide }>(
        "/api/compare",
        { method: "POST", body: JSON.stringify({ runId: id, force }) },
      );
      // 寫回發出請求的那一場（使用者可能已切到別場）
      setResults((prev) => ({
        ...prev,
        [id]: {
          comparison: d.comparison,
          swarm: null,
          viewerSide: d.viewerSide ?? prev[id]?.viewerSide ?? null,
        },
      }));
    } catch (e) {
      setSoloErr((prev) => ({ ...prev, [id]: apiErrorText(e, t, "cmp.soloErr") }));
    } finally {
      setBusy((prev) => {
        const { [id]: _drop, ...rest } = prev;
        return rest;
      });
    }
  }

  if (!me)
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 items-center justify-center p-8 text-muted">
          {loading ? t("common.loading") : t("common.pickIdentity")}
        </main>
      </>
    );

  const current = runId ? results[runId] : undefined;
  const data = current?.comparison ?? null;
  const swarm = data?.swarm ?? current?.swarm ?? null;
  const solo = data?.solo ?? null;
  const selected = runs?.find((r) => r.id === runId);
  const isBusy = Boolean(runId && busy[runId]);
  const err = runId ? (soloErr[runId] ?? loadErr[runId] ?? null) : null;
  const viewerSide = current?.viewerSide ?? null;

  const verdictText = (v: MatchReport["verdict"]) =>
    v === "recommend" ? t("rs.recommend") : v === "cautious" ? t("rs.cautious") : t("rs.pass");

  const swarmScoringSrc = data ? (data.swarm.scoringSource ?? data.swarm.source) : null;
  const soloScoringSrc = data ? (data.solo.scoringSource ?? data.solo.source) : null;
  const providerDiffers =
    swarmScoringSrc !== null &&
    soloScoringSrc !== null &&
    swarmScoringSrc.replace(/-single$/, "") !== soloScoringSrc.replace(/-single$/, "");

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl flex-1 px-4 pb-16">
        <div className="mt-8">
          <div className="tag mb-2">SECTION 9 {"// "}{t("cmp.tag")}</div>
          <h1 className="font-display text-xl font-bold">{t("cmp.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("cmp.desc")}</p>
        </div>

        {/* 選擇 run */}
        <div className="card mt-4 p-4">
          <div className="mb-2 text-xs font-bold text-muted">{t("cmp.pick")}</div>
          <div className="flex flex-wrap gap-2">
            {(runs ?? []).slice(0, 8).map((r) => (
              <button
                key={r.id}
                onClick={() => setPicked(r.id)}
                aria-pressed={runId === r.id}
                className={`chip ${runId === r.id ? "chip-on" : ""}`}
              >
                {r.other.emoji} {r.other.name} · {r.myReport?.score ?? "-"}
                {busy[r.id] ? " …" : ""}
              </button>
            ))}
            {runs === null && (
              <span className="text-xs text-muted">{t("common.loading")}</span>
            )}
            {runs?.length === 0 && (
              <span className="text-xs text-muted">{t("cmp.none")}</span>
            )}
          </div>
        </div>

        {runId && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => runSolo(runId, Boolean(solo))}
              disabled={isBusy}
              className="btn btn-accent px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {isBusy ? t("cmp.soloBusy") : solo ? t("cmp.soloRerun") : t("cmp.soloRun")}
            </button>
            {err && (
              <span role="alert" className="text-xs text-alert">
                {err}
              </span>
            )}
          </div>
        )}

        {viewerSide === "B" && swarm && (
          <div className="mt-3 border border-amber bg-amber-soft px-3 py-2 text-xs text-ink-soft">
            {t("cmp.viewerB")}
          </div>
        )}

        {swarm && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <SideCard
              title={t("cmp.swarm")}
              subtitle={t("cmp.swarmSub", {
                done: Number(swarm.extra.done ?? 0),
                expected: Number(swarm.extra.expected ?? swarm.calls),
                src: upper(swarm.source),
              })}
              metric={swarm}
              verdict={verdictText(swarm.verdict)}
              accent
            />
            {solo ? (
              <SideCard
                title={t("cmp.solo")}
                subtitle={t("cmp.soloSub", { src: upper(solo.source) })}
                metric={solo}
                verdict={verdictText(solo.verdict)}
              />
            ) : (
              <div className="card cut flex items-center justify-center p-6 text-center text-xs text-muted">
                {t("cmp.soloMissing")}
                <br />
                {t("cmp.soloMissingHint")}
              </div>
            )}
          </div>
        )}

        {data && (
          <>
            <div className="card mt-4 p-5">
              <div className="mb-3 text-sm font-bold">{t("cmp.table")}</div>
              <div className="mb-3 border-l-2 border-accent bg-panel-2/60 px-3 py-2 text-xs leading-relaxed text-ink-soft">
                {t("cmp.fairNote")}
                {providerDiffers && (
                  <>
                    {" "}
                    {t("cmp.providerNote", {
                      a: upper(swarmScoringSrc),
                      b: upper(soloScoringSrc),
                    })}
                  </>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-2 font-normal">{t("cmp.metric")}</th>
                      <th className="pb-2 font-normal">{t("cmp.colSwarm")}</th>
                      <th className="pb-2 font-normal">{t("cmp.colSolo")}</th>
                    </tr>
                  </thead>
                  <tbody className="mono text-[13px]">
                    <Row
                      label={t("cmp.rowScoring")}
                      a={fmtS(data.swarm.timing?.scoringMs)}
                      b={fmtS(data.solo.timing?.scoringMs ?? data.solo.latencyMs)}
                      strong
                    />
                    <Row
                      label={t("cmp.rowScoringSource")}
                      a={upper(swarmScoringSrc)}
                      b={upper(soloScoringSrc)}
                    />
                    <Row
                      label={t("cmp.rowScoringCalls")}
                      a={fmtN(data.swarm.callBreakdown?.scoringComparable)}
                      b={fmtN(data.solo.callBreakdown?.scoringComparable ?? data.solo.calls)}
                    />
                    <Row
                      label={t("cmp.rowTranscript")}
                      a={fmtS(data.swarm.timing?.transcriptMs)}
                      b={t("cmp.reused")}
                    />
                    <Row
                      label={t("cmp.rowTotal")}
                      a={fmtS(data.swarm.timing?.totalMs ?? data.swarm.latencyMs)}
                      b={fmtS(data.solo.timing?.totalMs ?? data.solo.latencyMs)}
                    />
                    <Row
                      label={t("cmp.rowCalls")}
                      a={t("cmp.callsSplit", {
                        n: data.swarm.calls,
                        tr: fmtN(data.swarm.callBreakdown?.transcript),
                        sc: fmtN(data.swarm.callBreakdown?.scoring),
                      })}
                      b={String(data.solo.calls)}
                    />
                    <Row
                      label={t("cmp.rowRetries")}
                      a={String(data.swarm.retries)}
                      b={String(data.solo.retries)}
                    />
                    <Row
                      label={t("cmp.rowPartMs")}
                      a={
                        data.swarm.extra.totalPartMs
                          ? fmtS(Number(data.swarm.extra.totalPartMs))
                          : "—"
                      }
                      b={t("cmp.noIsolation")}
                    />
                    <Row
                      label={t("cmp.rowTokens")}
                      a={`${fmtN(data.swarm.tokens?.input)} / ${fmtN(data.swarm.tokens?.output)}`}
                      b={`${fmtN(data.solo.tokens?.input)} / ${fmtN(data.solo.tokens?.output)}`}
                    />
                    <Row
                      label={t("cmp.rowFields")}
                      a={`${data.swarm.fieldsFilled}/${data.swarm.fieldsExpected}`}
                      b={`${data.solo.fieldsFilled}/${data.solo.fieldsExpected}`}
                    />
                    <Row
                      label={t("cmp.rowScore")}
                      a={`${data.swarm.score} (${upper(data.swarm.source)})`}
                      b={`${data.solo.score} (${upper(data.solo.source)})`}
                    />
                    <Row
                      label={t("cmp.rowVsRule")}
                      a={
                        data.swarm.extra.deltaVsRule !== null &&
                        data.swarm.extra.deltaVsRule !== undefined
                          ? `${Number(data.swarm.extra.deltaVsRule) >= 0 ? "+" : ""}${data.swarm.extra.deltaVsRule}`
                          : "—"
                      }
                      b="—"
                    />
                    <Row
                      label={t("cmp.rowResilience")}
                      a={t("cmp.resilienceSwarm", {
                        failed: Number(data.swarm.extra.failed ?? 0),
                        retries: data.swarm.retries,
                      })}
                      b={t("cmp.resilienceSolo")}
                    />
                  </tbody>
                </table>
              </div>
              <div className="mono mt-4 text-xs text-muted">
                {t("cmp.agreementScore")}{" "}
                <span className="text-accent">{data.agreement.scoreDiff}</span> ·{" "}
                {t("cmp.agreementDim")}{" "}
                <span className="text-accent">{data.agreement.dimAvgDiff}</span>
                <div className="mt-1 font-sans">{t("cmp.agreementNote")}</div>
              </div>
            </div>

            <div className="card mt-4 p-5">
              <div className="mb-3 text-sm font-bold">{t("cmp.dims")}</div>
              {DIM_KEYS.map(([k, labelKey]) => (
                <div key={k} className="mb-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-muted">{t(labelKey)}</span>
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
                {t("cmp.legendSwarm")} (<span className="text-accent">■</span>) ·{" "}
                {t("cmp.legendSolo")} (<span className="text-ink/60">■</span>)
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
  verdict,
  accent,
}: {
  title: string;
  subtitle: string;
  metric: SideMetrics;
  verdict: string;
  accent?: boolean;
}) {
  const { t } = useI18n();
  const providers = Array.isArray(metric.extra.providers)
    ? (metric.extra.providers as unknown[]).map(String)
    : [];
  return (
    <div className={`card cut p-4 ${accent ? "border-accent/50" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-display text-lg font-bold ${accent ? "text-accent" : ""}`}>
          {title}
        </span>
        <span className="mono text-right text-[10px] text-muted">{subtitle}</span>
      </div>
      <div className="mono mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          {t("cmp.score")} <span className="text-base font-bold">{metric.score}</span>
        </div>
        <div>
          {t("cmp.reasonsRisks")}{" "}
          <span className="text-base font-bold">
            {metric.reasons}/{metric.redFlags}
          </span>
        </div>
        <div>
          {t("cmp.fields")}{" "}
          <span className="font-bold">
            {metric.fieldsFilled}/{metric.fieldsExpected}
          </span>
        </div>
        <div>
          {t("cmp.scoringStep")}{" "}
          <span className="font-bold">
            {fmtS(metric.timing?.scoringMs ?? metric.latencyMs)}
          </span>
        </div>
        <div className="col-span-2">
          {t("cmp.totalFlow")}{" "}
          <span className="font-bold">{fmtS(metric.timing?.totalMs ?? metric.latencyMs)}</span>
          {metric.reusesSwarmTranscript && (
            <span className="ml-1 font-sans text-[11px] text-muted">
              {t("cmp.reusesTranscript")}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 text-xs text-muted">
        {t("cmp.verdict")} <span className="mono">{verdict}</span>
        {providers.length > 0 && (
          <>
            {" "}· {t("cmp.providers")}{" "}
            <span className="mono">{providers.map((p) => p.toUpperCase()).join("+")}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  a,
  b,
  strong,
}: {
  label: string;
  a: string;
  b: string;
  strong?: boolean;
}) {
  return (
    <tr className={`border-t border-line ${strong ? "bg-panel-2/60" : ""}`}>
      <td className={`py-2 pr-2 font-sans text-xs ${strong ? "font-bold text-ink" : "text-muted"}`}>
        {label}
      </td>
      <td className="py-2 pr-2 text-accent">{a}</td>
      <td className="py-2 text-ink-soft">{b}</td>
    </tr>
  );
}
