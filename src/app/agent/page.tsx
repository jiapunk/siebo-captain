"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ScoreRing from "@/components/ScoreRing";
import RunStream from "@/components/RunStream";
import { IconRadar } from "@/components/Icons";
import { api, timeAgo, useMe, useUserBus } from "@/lib/client";
import { useI18n } from "@/lib/i18n";
import type { MatchReport } from "@/lib/types";

interface RunParts {
  expected: number;
  done: number;
  failed: number;
  pending: number;
  retries: number;
  retainedPct: number | null;
  providers: string[];
  avgLatencyMs: number | null;
}

interface RunRow {
  id: string;
  status: string;
  other: { name: string; emoji: string; isBot: boolean };
  myReport: MatchReport | null;
  createdAt: string;
  matchId?: string | null;
  eventCount: number;
  parts: RunParts | null;
  partRows?: {
    id: string;
    kind: string;
    label: string;
    status: string;
    provider: string | null;
    latencyMs: number | null;
    retries: number;
  }[];
}

export default function AgentPage() {
  const { me, loading } = useMe();
  const { t } = useI18n();
  const router = useRouter();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [launching, setLaunching] = useState(false);
  const [assembling, setAssembling] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [eventCode, setEventCode] = useState("");
  const [joinedEvent, setJoinedEvent] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [evomap, setEvomap] = useState<{
    enabled: boolean;
    linked: boolean;
    nodeId?: string;
  } | null>(null);
  const [faultInject, setFaultInject] = useState(false);

  useEffect(() => {
    fetch("/api/evomap")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEvomap(d))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<{ runs: RunRow[] }>("/api/agent/runs");
      setRuns(d.runs);
      return d.runs;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!loading && !me) router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, me]);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  useUserBus(() => {
    load();
  });

  async function joinEvent() {
    if (!eventCode.trim() || joining) return;
    setJoining(true);
    setMsg(null);
    try {
      const { event } = await api<{ event: { name: string } }>(
        "/api/events/join",
        { method: "POST", body: JSON.stringify({ code: eventCode.trim() }) },
      );
      setJoinedEvent(event.name);
    } catch {
      setMsg(t("agent.joinErr"));
    } finally {
      setJoining(false);
    }
  }

  async function assemble() {
    if (assembling) return;
    setMsg(null);
    setAssembling(true);
    try {
      await api<{ teamIds: string[] }>("/api/teams/assemble", { method: "POST" });
      router.push("/teams");
    } catch (e) {
      const m = (e as Error).message;
      setMsg(
        m === "not_enough_candidates"
          ? t("agent.assembleErrCandidates")
          : m === "email_unverified"
            ? t("auth.gateBlocked")
            : t("agent.assembleErr"),
      );
    } finally {
      setAssembling(false);
    }
  }

  async function launch() {
    if (launching) return;
    setMsg(null);
    setLaunching(true);
    try {
      const { runIds } = await api<{ runIds: string[] }>("/api/matching/run", {
        method: "POST",
        body: JSON.stringify({ faultInject }),
      });
      await load();
      setExpanded(new Set(runIds));
    } catch (e) {
      const m = (e as Error).message;
      setMsg(
        m === "no_candidates"
          ? t("agent.launchErrNone")
          : m === "profile_not_ready"
            ? t("agent.launchErrProfile")
            : m === "email_unverified"
              ? t("auth.gateBlocked")
              : t("agent.launchErr"),
      );
    } finally {
      setLaunching(false);
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

  const ready = me.profileStatus === "ready";
  const activeRuns = runs.filter((r) => r.status === "running");
  const doneRuns = runs.filter((r) => r.status !== "running");
  const qualifying = doneRuns.filter((r) => (r.myReport?.score ?? 0) >= 60);
  const canAssemble = ready && activeRuns.length === 0 && qualifying.length >= 2;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl flex-1 px-4 pb-16">
        {/* 狀態面板 */}
        <div className="card cut mt-8">
          <div className="ticks-x" />
          <div className="flex flex-col items-center gap-5 p-6 sm:flex-row">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center border border-line-strong bg-base">
              <IconRadar
                size={26}
                className={activeRuns.length ? "text-accent" : "text-ink-soft"}
              />
            </span>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <div className="tag flex items-center justify-center gap-2 sm:justify-start">
                <span className={`led ${activeRuns.length ? "led-live" : "led-idle"}`} />
                OPS {"// "}{t("agent.tag").split("// ")[1]}
              </div>
              <h1 className="font-display mt-1.5 text-xl font-black">
                {activeRuns.length > 0
                  ? t("agent.active", { n: activeRuns.length })
                  : ready
                    ? t("agent.standby")
                    : t("agent.nofile")}
              </h1>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {activeRuns.length > 0
                  ? t("agent.descActive", { n: activeRuns.length })
                  : ready
                    ? t("agent.descReady")
                    : t("agent.descNoProfile")}
              </p>
            </div>
            {ready ? (
              <div className="flex flex-col items-end gap-1.5">
                <button
                  onClick={launch}
                  disabled={launching}
                  className="btn btn-accent px-6 py-3 disabled:opacity-60"
                >
                  <IconRadar size={17} />
                  {launching ? t("agent.deploying") : t("agent.deploy")}
                </button>
                <label className="mono flex cursor-pointer items-center gap-1.5 text-[10px] tracking-wider text-muted">
                  <input
                    type="checkbox"
                    checked={faultInject}
                    onChange={(e) => setFaultInject(e.target.checked)}
                    className="h-3 w-3 accent-[var(--phos)]"
                  />
                  故障演練（Part 首失敗 → 自動重試接力）
                </label>
              </div>
            ) : (
              <Link href="/onboarding" className="btn btn-accent px-6 py-3">
                {t("agent.startInterview")}
              </Link>
            )}
          </div>
        </div>

        {evomap && (
          <div className="mono mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border border-line bg-panel-2/40 px-3 py-2 text-[10px] tracking-wider text-muted">
            <span>
              EVOMAP {"//"}{" "}
              {evomap.enabled
                ? evomap.linked
                  ? `LINKED ${evomap.nodeId}`
                  : "ENABLED · 未綁定（npm run evomap:register）"
                : "OFF（opt-in：EVOMAP_ENABLED=1）"}
            </span>
            {evomap.enabled && evomap.linked && (
              <span className="text-console-dim">
                GEP-A2A · Gene+Capsule 發佈（npm run evomap:release）
              </span>
            )}
          </div>
        )}

        {runs.length > 0 && (
          <div className="mono mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border border-line bg-panel-2/40 px-3 py-2 text-[10px] tracking-wider text-muted">
            <span>
              DECISION {"// "}
              {(() => {
                const withSrc = doneRuns.filter((x) => x.myReport?.decisionSource);
                const n = (s: string) =>
                  withSrc.filter((x) => x.myReport?.decisionSource === s).length;
                const parts = [
                  n("jev") ? `JEV ×${n("jev")}` : null,
                  n("llm") ? `LLM ×${n("llm")}` : null,
                  n("mock") ? `LOCAL ×${n("mock")}` : null,
                ].filter(Boolean);
                return parts.length ? parts.join(" · ") : "—";
              })()}
            </span>
            <span>
              JEV vs RULE Δ{" "}
              {(() => {
                const deltas = doneRuns
                  .filter(
                    (x) =>
                      x.myReport?.decisionSource === "jev" &&
                      x.myReport?.ruleScore !== undefined,
                  )
                  .map((x) => (x.myReport!.score - x.myReport!.ruleScore!) as number);
                if (!deltas.length) return "—";
                const avg =
                  deltas.reduce((s, d) => s + d, 0) / deltas.length;
                return `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}（n=${deltas.length}）`;
              })()}
            </span>
          </div>
        )}

        {msg && (
          <div className="rise-in mt-3 border border-amber bg-amber-soft p-3 text-center text-sm text-ink-soft">
            {msg}
          </div>
        )}

        {!me.event && !joinedEvent && (
          <div className="card cut rise-in mt-3">
            <div className="p-4">
              <div className="tag mb-1.5">SECTOR {"// "}{t("agent.joinTag").split("// ")[1]}</div>
              <p className="text-xs leading-relaxed text-ink-soft">
                {t("agent.joinDesc")}
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  value={eventCode}
                  onChange={(e) => setEventCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && joinEvent()}
                  placeholder={t("agent.joinPh")}
                  className="mono min-w-0 flex-1 border border-line-strong bg-base px-3 py-2 text-sm tracking-wider outline-none focus:bg-panel-2"
                />
                <button
                  onClick={joinEvent}
                  disabled={!eventCode.trim() || joining}
                  className="btn btn-accent px-5 py-2 text-sm disabled:opacity-40"
                >
                  {joining ? t("agent.joining") : t("agent.join")}
                </button>
              </div>
            </div>
          </div>
        )}
        {joinedEvent && (
          <div className="rise-in mt-3 border border-sage bg-sage-soft p-3 text-center text-sm text-ink-soft">
            {t("agent.joined", { name: joinedEvent })}
          </div>
        )}

        {canAssemble && (
          <div className="card cut rise-in mt-4 border-accent">
            <div className="flex flex-col items-center gap-3 p-5 sm:flex-row">
              <span className="mono text-[11px] tracking-[0.16em] text-accent-deep">
                SQUAD FORMATION READY
              </span>
              <div className="min-w-0 flex-1 text-center text-sm text-ink-soft sm:text-left">
                {t("agent.assembleDesc", { n: qualifying.length })}
              </div>
              <button
                onClick={assemble}
                disabled={assembling}
                className="btn btn-accent px-6 py-2.5 text-sm disabled:opacity-60"
              >
                {assembling ? t("agent.assembling") : t("agent.assemble")}
              </button>
            </div>
          </div>
        )}

        {runs.length === 0 && ready && (
          <div className="card cut mt-4 p-10 text-center text-muted">
            <span className="mono text-xs tracking-wider">
              {t("agent.noRuns")}
            </span>
            <br />
            <span className="mt-2 inline-block text-sm">
              {t("agent.noRunsHint")}
            </span>
          </div>
        )}

        <SwarmBoard runs={runs} />

        {runs.length > 0 && (
          <div className="tag mt-8 mb-3">RECON {"// "}{t("agent.recon").split("// ")[1]}</div>
        )}

        <div className="space-y-3">
          {[...activeRuns, ...doneRuns].map((r) => {
            const isOpen = expanded.has(r.id);
            return (
              <div key={r.id} className="card cut">
                <button
                  onClick={() => {
                    const next = new Set(expanded);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    setExpanded(next);
                  }}
                  className="flex w-full items-center gap-3.5 p-4 text-left transition hover:bg-panel-2/60"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-line-strong bg-base text-xl">
                    {r.other.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{r.other.name}</span>
                      {r.other.isBot && (
                        <span className="mono border border-line px-1.5 py-0.5 text-[9px] tracking-wider text-muted">
                          SIM
                        </span>
                      )}
                      {r.status === "running" && (
                        <span className="flex items-center gap-1.5 border border-sage px-1.5 py-0.5">
                          <span className="led led-live" />
                          <span className="mono text-[9px] tracking-wider text-sage">
                            {t("agent.live")}
                          </span>
                        </span>
                      )}
                    </div>
                    <div className="mono mt-1 text-[10px] tracking-wider text-muted">
                      {timeAgo(r.createdAt)} {"// "}
                      {r.status === "running"
                        ? t("agent.transmitting")
                        : t("agent.signals", { n: r.eventCount })}
                    </div>
                    {r.parts && (
                      <div className="mono mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tracking-wider">
                        <span
                          className={
                            r.parts.failed > 0 || r.parts.pending > 0
                              ? "text-amber"
                              : "text-phos"
                          }
                        >
                          PARTS {r.parts.done}/{r.parts.expected}
                        </span>
                        {r.parts.retries > 0 && (
                          <span className="text-amber">
                            RETRY {r.parts.retries}
                          </span>
                        )}
                        {r.parts.retainedPct !== null && (
                          <span className="text-muted">
                            RETAIN {r.parts.retainedPct}%
                          </span>
                        )}
                        {r.parts.providers.length > 0 && (
                          <span className="text-muted">
                            {r.parts.providers.map((x) => x.toUpperCase()).join("+")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {r.myReport && (
                    <div className="shrink-0">
                      <ScoreRing score={r.myReport.score} size={50} />
                    </div>
                  )}
                  <span className="mono ml-1 text-[10px] tracking-wider text-muted">
                    {isOpen ? t("agent.close") : t("agent.open")}
                  </span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4">
                    <RunStream
                      runId={r.id}
                      other={r.other}
                      onDone={() => load()}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}

interface LivePart {
  type?: string;
  runId: string;
  candidate?: string;
  candidateEmoji?: string;
  partId: string;
  kind: string;
  label: string;
  phase: "pending" | "running" | "retry" | "done" | "failed";
  attempt?: number;
  provider?: string | null;
  latencyMs?: number;
  retries?: number;
  error?: string;
  ts?: number;
}

const PHASE_STYLE: Record<LivePart["phase"], string> = {
  pending: "border-line text-muted",
  running: "border-console-amber/60 text-console-amber animate-pulse",
  retry: "border-alert text-alert",
  done: "border-console-green/50 text-console-green",
  failed: "border-alert text-alert",
};

/** 蜂群即時面板：bus SSE 即時事件 + DB 回填（重新載入也有畫面） */
function SwarmBoard({ runs: runRows }: { runs: RunRow[] }) {
  const [parts, setParts] = useState<Record<string, LivePart>>({});
  const [runOrder, setRunOrder] = useState<string[]>([]);

  // DB 回填：以最近 3 場的 partRows 補齊面板（bus 事件優先，不覆蓋）
  useEffect(() => {
    const recent = runRows.slice(0, 3);
    if (recent.length === 0) return;
    setParts((prev) => {
      const next = { ...prev };
      for (const r of recent) {
        for (const pr of r.partRows ?? []) {
          if (next[pr.id]) continue;
          next[pr.id] = {
            runId: r.id,
            candidate: r.other?.name,
            candidateEmoji: r.other?.emoji,
            partId: pr.id,
            kind: pr.kind,
            label: pr.label,
            phase:
              pr.status === "done"
                ? "done"
                : pr.status === "failed"
                  ? "failed"
                  : "pending",
            provider: pr.provider,
            latencyMs: pr.latencyMs ?? undefined,
            retries: pr.retries,
          };
        }
      }
      return next;
    });
    setRunOrder((prev) => {
      const ids = recent.map((r) => r.id).filter((id) => !prev.includes(id));
      return ids.length ? [...ids, ...prev] : prev;
    });
  }, [runRows]);

  useEffect(() => {
    const es = new EventSource("/api/bus/user");
    es.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data) as LivePart;
        if (m.type !== "part") return;
        setParts((prev) => ({ ...prev, [m.partId]: { ...m, ts: Date.now() } }));
        setRunOrder((prev) => (prev.includes(m.runId) ? prev : [...prev, m.runId]));
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);

  const runs = runOrder.slice(-3);
  if (runs.length === 0) return null;

  return (
    <div className="card cut mt-3 border-console-soft p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="mono text-[11px] tracking-[0.16em] text-console-green">
          SWARM {"//"} LIVE PARTS
        </span>
        <span className="text-[11px] text-muted">
          每個 Part 隔離執行、獨立重試；開啟「故障演練」看成員失效後如何接力
        </span>
      </div>
      <div className="space-y-2">
        {runs.map((runId) => {
          const mine = Object.values(parts)
            .filter((p) => p.runId === runId)
            .sort((x, y) => x.partId.localeCompare(y.partId));
          const done = mine.filter((p) => p.phase === "done").length;
          const retries = mine.reduce((acc, p) => acc + (p.retries ?? 0), 0);
          const candidate = mine[0]?.candidate ?? "?";
          const emoji = mine[0]?.candidateEmoji ?? "·";
          return (
            <div key={runId} className="flex flex-wrap items-center gap-1.5">
              <span className="mono w-32 shrink-0 text-[11px] text-ink-soft">
                {emoji} {candidate}
              </span>
              {mine.map((p) => (
                <span
                  key={p.partId}
                  title={`${p.label} · ${p.phase}${p.error ? ` · ${p.error}` : ""}`}
                  className={`mono inline-flex min-w-[104px] flex-col rounded border bg-panel-2/40 px-1.5 py-1 text-[9px] leading-tight ${PHASE_STYLE[p.phase]}`}
                >
                  <span className="truncate">{p.label}</span>
                  <span className="opacity-75">
                    {p.phase === "running"
                      ? `attempt ${p.attempt ?? 1}`
                      : p.phase === "retry"
                        ? "重試接力…"
                        : `${p.provider ?? "—"}${p.latencyMs ? ` ${p.latencyMs}ms` : ""}${p.retries ? ` · R${p.retries}` : ""}`}
                  </span>
                </span>
              ))}
              <span className="mono text-[10px] text-muted">
                {done}/{mine.length}
                {retries > 0 && <span className="text-alert"> · RETRY {retries}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
