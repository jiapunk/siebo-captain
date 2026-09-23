"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ScoreRing from "@/components/ScoreRing";
import RunStream, { useRunStreams } from "@/components/RunStream";
import { IconRadar } from "@/components/Icons";
import {
  api,
  ApiError,
  apiErrorText,
  timeAgo,
  useMe,
  useUserBus,
  type BusEvent,
} from "@/lib/client";
import { useI18n } from "@/lib/i18n";
import type { MatchReport } from "@/lib/types";

interface RunParts {
  expected: number;
  done: number;
  failed: number;
  pending: number;
  retries: number;
  /** 遠端失敗後改用本機腳本完成的 Part 數 */
  fallbacks?: number;
  retainedPct: number | null;
  providers: string[];
  avgLatencyMs: number | null;
}

interface PartRow {
  id: string;
  kind: string;
  label: string;
  status: string;
  provider: string | null;
  latencyMs: number | null;
  retries: number;
}

interface RunRow {
  id: string;
  status: string;
  /** id：對象的 userId（舊版 API 沒有這個欄位時，改用 name+emoji 當近似鍵） */
  other: { id?: string; name: string; emoji: string; isBot: boolean };
  myReport: MatchReport | null;
  createdAt: string;
  matchId?: string | null;
  eventCount: number;
  parts: RunParts | null;
  partRows?: PartRow[];
}

const sourceLabel = (s: string) => (s === "mock" ? "LOCAL" : s.toUpperCase());

/** 以「對象」為單位的鍵：同一個人重跑多次互盤只算一位 */
const peerKey = (r: RunRow) => r.other.id ?? `${r.other.name}\u0000${r.other.emoji}`;

/** 每位對象只取最新一筆「已完成」的互盤（runs 依 createdAt 新→舊），與組隊／雷達的 latestRunPerPeer 同規則 */
function latestCompletedPerPeer(runs: RunRow[]): RunRow[] {
  const out = new Map<string, RunRow>();
  for (const r of runs) {
    if (r.status !== "completed") continue;
    const k = peerKey(r);
    const prev = out.get(k);
    if (!prev || Date.parse(r.createdAt) > Date.parse(prev.createdAt)) out.set(k, r);
  }
  return [...out.values()];
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
  /** 非錯誤的說明（例如這輪出發其實是重新評估已見過的人） */
  const [note, setNote] = useState<string | null>(null);
  const [eventCode, setEventCode] = useState("");
  const [joinedEvent, setJoinedEvent] = useState<string | null>(null);
  /** 出發被擋在 409 no_event：就算 /api/me 的活動資訊過期，也把加入活動的卡片叫出來 */
  const [needEvent, setNeedEvent] = useState(false);
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

  // 請求序號：回應亂序時只套用比「已套用」更新的那一個，舊回應不會蓋掉新狀態
  const reqSeq = useRef(0);
  const appliedSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    return api<{ runs: RunRow[] }>("/api/agent/runs")
      .then((d) => {
        if (seq > appliedSeq.current) {
          appliedSeq.current = seq;
          setRuns(d.runs);
        }
        return d.runs;
      })
      .catch(() => [] as RunRow[]);
  }, []);

  useEffect(() => {
    if (!loading && !me) router.replace("/");
  }, [loading, me, router]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  // 共用 user bus：part 事件也會更新 PARTS 計數，但防抖（300ms，最長 1.5s 一次），一次出發只重抓十來次
  useUserBus(
    () => {
      void load();
    },
    { types: ["part", "run_started", "refresh", "ready"] },
  );

  // 展開中的 run → 一條多工逐字稿串流（進行中的排前面）
  const streamIds = useMemo(() => {
    const order = new Map(runs.map((r, i) => [r.id, (r.status === "running" ? 0 : 1000) + i]));
    return Array.from(expanded).sort(
      (a, b) => (order.get(a) ?? -1) - (order.get(b) ?? -1),
    );
  }, [expanded, runs]);
  const streams = useRunStreams(streamIds, () => {
    void load();
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
    } catch (e) {
      setMsg(apiErrorText(e, t, "agent.joinErr", { not_found: "agent.joinErr" }));
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
      setMsg(
        apiErrorText(e, t, "agent.assembleErr", {
          not_enough_candidates: "agent.assembleErrCandidates",
          already_running: "err.assembleRunning",
        }),
      );
    } finally {
      setAssembling(false);
    }
  }

  async function launch() {
    if (launching) return;
    setMsg(null);
    setNote(null);
    setLaunching(true);
    // 出發前已完成互盤的對象（列表只含最近 30 場，太舊的見過紀錄可能漏算）
    const metBefore = new Set(latestCompletedPerPeer(runs).map(peerKey));
    try {
      const { runIds } = await api<{ runIds: string[] }>("/api/matching/run", {
        method: "POST",
        body: JSON.stringify({ faultInject }),
      });
      const fresh = await load();
      setExpanded(new Set(runIds));
      // 候選輪替：所有人都見過一輪後，出發會重新評估最久沒互盤的對象——明講，別讓人以為是新對象
      const launched = new Set(runIds);
      const reeval = fresh.filter((r) => launched.has(r.id) && metBefore.has(peerKey(r))).length;
      if (reeval > 0) setNote(t("agent.reevalNote", { n: reeval, total: runIds.length }));
    } catch (e) {
      setMsg(
        apiErrorText(e, t, "agent.launchErr", {
          no_candidates: "agent.launchErrNone",
          no_event: "agent.launchErrNoEvent",
          profile_not_ready: "agent.launchErrProfile",
        }),
      );
      if (e instanceof ApiError && e.code === "no_event") setNeedEvent(true);
      // 上一輪還在跑：把那幾場展開，直接看進度
      if (e instanceof ApiError && e.code === "already_running") {
        const ids = Array.isArray(e.body.runIds)
          ? (e.body.runIds as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        await load();
        if (ids.length) setExpanded((prev) => new Set([...prev, ...ids]));
      }
    } finally {
      setLaunching(false);
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

  const ready = me.profileStatus === "ready";
  const activeRuns = runs.filter((r) => r.status === "running");
  const doneRuns = runs.filter((r) => r.status !== "running");
  // 算「人」不算「場」：同一位對象重跑多次只看最新一場，人數才不會灌水
  const qualifying = latestCompletedPerPeer(doneRuns).filter(
    (r) => (r.myReport?.score ?? 0) >= 60,
  );
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
                {t("agent.tag")}
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
                  {t("agent.faultInject")}
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
                  ? `LINKED ${evomap.nodeId ?? ""}`
                  : t("agent.evomapUnlinked")
                : t("agent.evomapOff")}
            </span>
            {evomap.enabled && evomap.linked && (
              <span className="text-console-dim">{t("agent.evomapRelease")}</span>
            )}
          </div>
        )}

        {runs.length > 0 && (
          <div className="mono mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border border-line bg-panel-2/40 px-3 py-2 text-[10px] tracking-wider text-muted">
            <span title={t("agent.decisionHint")}>
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
            <span title={t("agent.fallbackHint")}>
              FALLBACK {"// "}
              {(() => {
                const remote = doneRuns.filter(
                  (x) =>
                    x.myReport?.decisionSource &&
                    x.myReport.decisionSource !== "mock" &&
                    x.myReport.decisionCoverage,
                );
                if (!remote.length) return "—";
                const fb = remote.reduce((a, x) => a + (x.myReport!.fallbackCount ?? 0), 0);
                const total = remote.reduce(
                  (a, x) => a + (x.myReport!.decisionCoverage?.expected ?? 0),
                  0,
                );
                return `${fb}/${total}`;
              })()}
            </span>
            <span title={t("agent.deltaHint")}>
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
                return `${avg >= 0 ? "+" : ""}${avg.toFixed(1)} (n=${deltas.length})`;
              })()}
            </span>
          </div>
        )}

        {msg && (
          <div
            role="alert"
            className="rise-in mt-3 border border-amber bg-amber-soft p-3 text-center text-sm text-ink-soft"
          >
            {msg}
          </div>
        )}
        {note && (
          <div
            role="status"
            className="rise-in mt-3 border border-line-strong bg-panel-2 p-3 text-center text-sm text-ink-soft"
          >
            {note}
          </div>
        )}

        {(!me.event || needEvent) && !joinedEvent && (
          <div className="card cut rise-in mt-3">
            <div className="p-4">
              <div className="tag mb-1.5">{t("agent.joinTag")}</div>
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
                {t("agent.squadReady")}
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
          <div className="tag mt-8 mb-3">{t("agent.recon")}</div>
        )}

        <div className="space-y-3">
          {[...activeRuns, ...doneRuns].map((r) => {
            const isOpen = expanded.has(r.id);
            const stream = streams[r.id];
            const rep = r.myReport;
            const retention = rep?.retention;
            const cov = rep?.decisionCoverage;
            const remoteSrc =
              rep?.decisionSource && rep.decisionSource !== "mock" ? rep.decisionSource : null;
            return (
              <div key={r.id} className="card cut">
                <button
                  onClick={() => {
                    const next = new Set(expanded);
                    if (next.has(r.id)) next.delete(r.id);
                    else next.add(r.id);
                    setExpanded(next);
                  }}
                  aria-expanded={isOpen}
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
                          {t("agent.sim")}
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
                      {r.status === "failed" && (
                        <span className="mono border border-alert px-1.5 py-0.5 text-[9px] tracking-wider text-alert">
                          {t("agent.failed")}
                        </span>
                      )}
                    </div>
                    <div className="mono mt-1 text-[10px] tracking-wider text-muted">
                      {timeAgo(r.createdAt, t)} {"// "}
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
                        <span
                          title={t("agent.retryHint")}
                          className={r.parts.retries > 0 ? "text-amber" : "text-muted"}
                        >
                          RETRY {r.parts.retries}
                        </span>
                        {(r.parts.fallbacks ?? 0) > 0 && (
                          <span title={t("agent.partFallbackHint")} className="text-amber">
                            LOCAL-FB {r.parts.fallbacks}
                          </span>
                        )}
                        {retention ? (
                          <span
                            title={t("agent.retainHint")}
                            className={retention.retained ? "text-muted" : "text-amber"}
                          >
                            RETAIN {retention.kept}/{retention.slots}
                          </span>
                        ) : r.parts.retainedPct !== null ? (
                          <span title={t("agent.retainHint")} className="text-muted">
                            RETAIN {r.parts.retainedPct}%
                          </span>
                        ) : null}
                        {rep?.decisionSource && (
                          <span title={t("agent.engineHint")} className="text-muted">
                            ENGINE {sourceLabel(rep.decisionSource)}
                            {remoteSrc && cov ? ` ${cov.remote}/${cov.expected}` : ""}
                          </span>
                        )}
                        {remoteSrc && rep?.fallbackCount !== undefined && (
                          <span
                            title={t("agent.fallbackHint")}
                            className={rep.fallbackCount > 0 ? "text-amber" : "text-muted"}
                          >
                            FALLBACK {rep.fallbackCount}
                          </span>
                        )}
                        {r.parts.providers.length > 0 && (
                          <span className="text-muted">
                            {r.parts.providers.map(sourceLabel).join("+")}
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
                      other={r.other}
                      events={stream?.events ?? []}
                      closed={stream?.closed ?? false}
                      lost={stream?.lost}
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
  fallback?: boolean;
  error?: string;
}

const PHASE_STYLE: Record<LivePart["phase"], string> = {
  pending: "border-line text-muted",
  running: "border-console-amber/60 text-console-amber animate-pulse",
  retry: "border-alert text-alert",
  done: "border-console-green/50 text-console-green",
  failed: "border-alert text-alert",
};

/** 階段先後：DB 回填比 bus 事件更後面時（漏收事件）以 DB 為準 */
const PHASE_RANK: Record<LivePart["phase"], number> = {
  pending: 0,
  running: 1,
  retry: 2,
  done: 3,
  failed: 3,
};

/** Part id 形如 q:<runId>:A → 依 kind 與 side 在前端翻譯（伺服器存的 label 固定是繁中） */
const PART_LABEL_KEYS: Record<string, string> = {
  qA: "agent.partQA",
  qB: "agent.partQB",
  aA: "agent.partAA",
  aB: "agent.partAB",
  rA: "agent.partRA",
  rB: "agent.partRB",
};
function partLabel(p: LivePart, t: (k: string) => string): string {
  const m = /^([qar]):.+:([AB])$/.exec(p.partId);
  const key = m ? PART_LABEL_KEYS[m[1] + m[2]] : undefined;
  return key ? t(key) : p.label;
}

/** 同一次出發最多 5 場（matching.ts MAX_CANDIDATES） */
const BOARD_RUNS = 5;

/** 蜂群即時面板：共用 user bus 的 part 事件 + DB 回填（重新載入也有畫面） */
function SwarmBoard({ runs: runRows }: { runs: RunRow[] }) {
  const { t } = useI18n();
  const [live, setLive] = useState<Record<string, LivePart>>({});

  useUserBus(
    (evt: BusEvent) => {
      const m = evt as unknown as LivePart;
      if (typeof m.partId !== "string" || typeof m.runId !== "string") return;
      setLive((prev) => ({ ...prev, [m.partId]: m }));
    },
    { types: ["part"], debounceMs: 0 },
  );

  // DB 回填（最近幾場）與即時事件合併：同一個 Part 取階段較後者，同階段以即時事件為準
  const { order, byRun } = useMemo(() => {
    const merged: Record<string, LivePart> = {};
    const recent = runRows.slice(0, BOARD_RUNS);
    for (const r of recent) {
      for (const pr of r.partRows ?? []) {
        merged[pr.id] = {
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
                : pr.status === "running"
                  ? "running"
                  : "pending",
          provider: pr.provider,
          latencyMs: pr.latencyMs ?? undefined,
          retries: pr.retries,
        };
      }
    }
    for (const p of Object.values(live)) {
      const db = merged[p.partId];
      if (!db || PHASE_RANK[p.phase] >= PHASE_RANK[db.phase]) merged[p.partId] = { ...db, ...p };
    }
    const byRun = new Map<string, LivePart[]>();
    for (const p of Object.values(merged)) {
      const list = byRun.get(p.runId) ?? [];
      list.push(p);
      byRun.set(p.runId, list);
    }
    // 順序：列表中的 run（新的在前），列表還沒回填的即時 run 排最前
    const known = recent.map((r) => r.id);
    const liveOnly = Array.from(byRun.keys()).filter((id) => !runRows.some((r) => r.id === id));
    const order = [...liveOnly, ...known].filter((id) => byRun.has(id)).slice(0, BOARD_RUNS);
    return { order, byRun };
  }, [runRows, live]);

  if (order.length === 0) return null;

  return (
    <div className="card cut mt-3 border-console-soft p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <span className="mono text-[11px] tracking-[0.16em] text-console-green">
          SWARM {"//"} LIVE PARTS
        </span>
        <span className="text-[11px] text-muted">{t("agent.swarmDesc")}</span>
      </div>
      <div className="space-y-2">
        {order.map((runId) => {
          const mine = [...(byRun.get(runId) ?? [])].sort((x, y) =>
            x.partId.localeCompare(y.partId),
          );
          const done = mine.filter((p) => p.phase === "done").length;
          const retries = mine.reduce((acc, p) => acc + (p.retries ?? 0), 0);
          const row = runRows.find((r) => r.id === runId);
          const candidate = mine.find((p) => p.candidate)?.candidate ?? row?.other.name ?? "?";
          const emoji =
            mine.find((p) => p.candidateEmoji)?.candidateEmoji ?? row?.other.emoji ?? "·";
          return (
            <div key={runId} className="flex flex-wrap items-center gap-1.5">
              <span className="mono w-32 shrink-0 truncate text-[11px] text-ink-soft">
                {emoji} {candidate}
              </span>
              {mine.map((p) => (
                <span
                  key={p.partId}
                  title={`${partLabel(p, t)} · ${p.phase}${p.error ? ` · ${p.error}` : ""}`}
                  className={`mono inline-flex min-w-[104px] flex-col rounded border bg-panel-2/40 px-1.5 py-1 text-[9px] leading-tight ${PHASE_STYLE[p.phase]}`}
                >
                  <span className="truncate">{partLabel(p, t)}</span>
                  <span className="opacity-75">
                    {p.phase === "running"
                      ? t("agent.partAttempt", { n: p.attempt ?? 1 })
                      : p.phase === "retry"
                        ? t("agent.partRetrying")
                        : `${p.provider ? sourceLabel(p.provider) : "—"}${p.latencyMs ? ` ${p.latencyMs}ms` : ""}${p.retries ? ` · R${p.retries}` : ""}${p.fallback ? " · FB" : ""}`}
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
