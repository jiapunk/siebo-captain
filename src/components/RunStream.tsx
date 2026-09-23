"use client";

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useT } from "@/lib/i18n";
import type { RunEvent } from "@/lib/types";

/** 多工串流一次最多看幾場（與 /api/agent/runs/stream 的 MAX_STREAM_RUNS 一致） */
const MAX_STREAM_RUNS = 8;
/** 伺服器拒絕連線（401／403／429…）後的重試間隔與次數 */
const RETRY_MS = 4000;
const MAX_RETRIES = 3;

export interface RunStreamState {
  events: RunEvent[];
  /** 已收到 run_closed（或連線多次失敗後放棄） */
  closed: boolean;
  /** running | completed | failed | missing */
  status: string | null;
  /** 連線失敗而放棄（非正常結束） */
  lost?: boolean;
}

type StreamMsg = {
  type: string;
  runId?: string;
  seq?: number;
  event?: RunEvent;
  status?: string;
};

/**
 * 一條 SSE 同時看多場互盤逐字稿（GET /api/agent/runs/stream?ids=a,b,c）。
 * - ids：想看的 run（呼叫端決定順序，進行中的排前面）；已結束且歷史已補完的 run 不再佔連線
 * - 需要看的 run 都已在目前連線內時不重連；有新的 run 才換一條涵蓋全部的新連線
 * - 事件以內容去重（重連時伺服器會重送歷史），所以換連線不會重複顯示
 * - onRunClosed(runId, status)：進行中的 run 結束時呼叫（例如重新整理列表）
 * 整頁只會有這一條 run 串流，加上共用的 user bus，總共 ≤ 2 條 SSE。
 */
export function useRunStreams(
  ids: string[],
  onRunClosed?: (runId: string, status: string) => void,
): Record<string, RunStreamState> {
  const [streams, setStreams] = useState<Record<string, RunStreamState>>({});
  // 重試計時器觸發時遞增，讓同步 effect 重新檢查
  const [tick, setTick] = useState(0);
  const esRef = useRef<{ es: EventSource; ids: Set<string> } | null>(null);
  const seenRef = useRef(new Map<string, Set<string>>());
  const liveRef = useRef(new Set<string>());
  // 已結束的 run（訊息處理當下同步更新）：effect 可能晚於後續訊息才執行，不能只信 render 時的 needKey
  const doneRef = useRef(new Set<string>());
  const failRef = useRef(new Map<string, number>());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedCb = useEffectEvent((runId: string, status: string) =>
    onRunClosed?.(runId, status),
  );

  const finished = (id: string) => {
    const s = streams[id];
    return Boolean(s?.closed);
  };
  const need = ids.filter((id) => !finished(id)).slice(0, MAX_STREAM_RUNS);
  const needKey = need.join(",");

  // 卸載時關閉連線
  useEffect(
    () => () => {
      esRef.current?.es.close();
      esRef.current = null;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  useEffect(() => {
    const wanted = (needKey ? needKey.split(",") : []).filter(
      (id) => !doneRef.current.has(id),
    );
    const cur = esRef.current;
    if (wanted.length === 0) return;
    if (cur && wanted.every((id) => cur.ids.has(id))) return;

    cur?.es.close();
    const streamIds = new Set(wanted);
    const es = new EventSource(
      `/api/agent/runs/stream?ids=${wanted.map(encodeURIComponent).join(",")}`,
    );
    esRef.current = { es, ids: streamIds };

    const patch = (runId: string, fn: (s: RunStreamState) => RunStreamState) =>
      setStreams((prev) => {
        const base = prev[runId] ?? { events: [], closed: false, status: null };
        return { ...prev, [runId]: fn(base) };
      });

    es.onmessage = (e) => {
      let msg: StreamMsg;
      try {
        msg = JSON.parse(e.data) as StreamMsg;
      } catch {
        return;
      }
      const runId = msg.runId;
      if (msg.type === "closed") {
        es.close();
        if (esRef.current?.es === es) esRef.current = null;
        setTick((n) => n + 1);
        return;
      }
      if (!runId || !streamIds.has(runId)) return;
      failRef.current.delete(runId);
      if (msg.type === "event" && msg.event) {
        const key = JSON.stringify(msg.event);
        let seen = seenRef.current.get(runId);
        if (!seen) {
          seen = new Set();
          seenRef.current.set(runId, seen);
        }
        if (seen.has(key)) return;
        seen.add(key);
        const ev = msg.event;
        patch(runId, (s) => ({ ...s, events: [...s.events, ev] }));
      } else if (msg.type === "ready") {
        if (msg.status === "running") liveRef.current.add(runId);
        patch(runId, (s) => ({ ...s, status: msg.status ?? s.status }));
      } else if (msg.type === "run_closed") {
        const status = msg.status ?? "completed";
        doneRef.current.add(runId);
        patch(runId, (s) => ({ ...s, closed: true, lost: false, status }));
        if (liveRef.current.delete(runId)) closedCb(runId, status);
      }
    };
    es.onerror = () => {
      // CONNECTING＝瀏覽器會自動重連（伺服器重送歷史，靠內容去重）；CLOSED＝被拒，改由這裡排程重試
      if (es.readyState !== EventSource.CLOSED) return;
      if (esRef.current?.es === es) esRef.current = null;
      const giveUp: string[] = [];
      for (const id of streamIds) {
        const n = (failRef.current.get(id) ?? 0) + 1;
        failRef.current.set(id, n);
        if (n >= MAX_RETRIES) {
          giveUp.push(id);
          doneRef.current.add(id);
        }
      }
      if (giveUp.length)
        setStreams((prev) => {
          const next = { ...prev };
          for (const id of giveUp) {
            const base = next[id] ?? { events: [], closed: false, status: null };
            next[id] = { ...base, closed: true, lost: true };
          }
          return next;
        });
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => setTick((n) => n + 1), RETRY_MS);
    };
  }, [needKey, tick]);

  return streams;
}

/** 一場互盤的逐字稿面板（純顯示；資料來自 useRunStreams） */
export default function RunStream({
  other,
  events,
  closed,
  lost,
}: {
  other: { name: string; emoji: string; isBot: boolean };
  events: RunEvent[];
  closed: boolean;
  lost?: boolean;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  // 使用者停在底部附近時才自動捲動；往上翻閱時不打擾
  const stickRef = useRef(true);

  // 只捲動自己的容器（不 scrollIntoView，避免 5 場同時直播時把整個視窗拉來拉去）
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && stickRef.current) box.scrollTop = box.scrollHeight;
  }, [events.length, closed]);

  const reportA = events.find(
    (e) => e.type === "report" && e.side === "A",
  ) as Extract<RunEvent, { type: "report" }> | undefined;

  const segColor = (v: number) =>
    v >= 70 ? "var(--console-green)" : v >= 55 ? "var(--console-amber)" : "var(--console-dim)";

  return (
    <div className="console cut mt-2 p-4">
      {/* 標頭 */}
      <div className="flex items-center gap-3 border-b border-console-soft pb-3">
        <span className={`led ${closed ? "led-idle" : "led-live"}`} />
        <span className="mono text-[11px] tracking-[0.18em] text-console-dim">
          CAPTAIN LINK {"// "}
          {lost ? t("rs.linkLost") : closed ? t("rs.archived") : t("agent.live")}
        </span>
        <span className="mono ml-auto text-[11px] tracking-wider text-console-dim">
          {other.name.toUpperCase()} {"// "}
          {t("agent.signals", { n: events.length })}
        </span>
      </div>

      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="mt-3 max-h-96 space-y-3 overflow-y-auto overscroll-contain pr-1"
      >
        {events.map((ev, i) => {
          if (ev.type === "phase")
            return (
              <div
                key={i}
                className="mono flex items-center gap-3 text-[11px] tracking-wider text-console-dim"
              >
                <span className="text-console-amber">▸</span>
                {ev.text}
              </div>
            );
          if (ev.type === "question" || ev.type === "answer") {
            const isA = ev.side === "A";
            return (
              <div
                key={i}
                className={`rise-in flex ${isA ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[86%] border-l-2 bg-console-soft px-3.5 py-2.5 ${
                    isA ? "border-accent" : "border-console-dim"
                  }`}
                >
                  <div className="mono mb-1 text-[9px] tracking-[0.16em] text-console-dim">
                    {isA ? t("rs.yourCaptain") : t("rs.captainOf", { name: other.name })}
                  </div>
                  <div className="text-sm leading-relaxed text-console-ink">
                    {ev.text}
                  </div>
                </div>
              </div>
            );
          }
          if (ev.type === "report") {
            const isA = ev.side === "A";
            const r = ev.report;
            const verdictText =
              r.verdict === "recommend"
                ? t("rs.recommend")
                : r.verdict === "cautious"
                  ? t("rs.cautious")
                  : t("rs.pass");
            const verdictColor =
              r.verdict === "recommend"
                ? "var(--console-green)"
                : r.verdict === "cautious"
                  ? "var(--console-amber)"
                  : "var(--console-dim)";
            return (
              <div
                key={i}
                className="rise-in border border-console-soft bg-console-soft/40 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="mono text-[10px] tracking-[0.16em] text-console-dim">
                    {isA ? t("rs.yourCaptainShort") : t("rs.captainOf", { name: other.name })}{" "}
                    {t("rs.report")}
                  </span>
                  <span className="flex items-center gap-2">
                    {r.decisionSource && (
                      <span className="mono border border-console-soft px-1.5 py-0.5 text-[9px] tracking-[0.16em] text-console-dim">
                        ENGINE {"//"} {r.decisionSource === "mock" ? "LOCAL" : r.decisionSource.toUpperCase()}
                        {r.ruleScore !== undefined &&
                          r.decisionSource !== "mock" && (
                            <>
                              {" "}· RULE {r.ruleScore} → {r.score}
                              <span
                                className={
                                  r.score > r.ruleScore
                                    ? " text-console-green"
                                    : r.score < r.ruleScore
                                      ? " text-console-amber"
                                      : ""
                                }
                              >
                                {" "}
                                {r.score === r.ruleScore
                                  ? "Δ0"
                                  : `Δ${r.score > r.ruleScore ? "+" : ""}${r.score - r.ruleScore}`}
                              </span>
                            </>
                          )}
                      </span>
                    )}
                    <span
                      className="mono text-[11px] font-bold tracking-wider"
                      style={{ color: verdictColor }}
                    >
                      {verdictText}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className="mono text-4xl font-bold leading-none"
                    style={{ color: segColor(r.score) }}
                  >
                    {r.score}
                  </span>
                  <div className="flex-1">
                    <div className="flex gap-[3px]">
                      {Array.from({ length: 12 }).map((_, k) => (
                        <span
                          key={k}
                          className="h-1.5 flex-1"
                          style={{
                            background:
                              k < Math.round((r.score / 100) * 12)
                                ? segColor(r.score)
                                : "var(--console-soft)",
                          }}
                        />
                      ))}
                    </div>
                    <div className="mono mt-1.5 text-[10px] tracking-wider text-console-dim">
                      {t("rs.compat")}
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-console-ink">
                  {r.summaryForUser}
                </p>
              </div>
            );
          }
          if (ev.type === "done")
            return (
              <div
                key={i}
                className="mono border border-console-soft py-2.5 text-center text-xs tracking-wider text-console-amber"
              >
                ▣ {ev.text}
              </div>
            );
          return null;
        })}
        {!closed && (
          <div className="mono flex items-center gap-2 py-1 text-[11px] tracking-wider text-console-dim">
            <span className="led led-live" />
            {t("rs.transmitting")}
          </div>
        )}
        {lost && (
          <div className="mono py-1 text-[11px] tracking-wider text-console-amber">
            {t("rs.linkLostHint")}
          </div>
        )}
      </div>

      {reportA && (
        <div className="mt-4 border-t border-console-soft pt-4">
          <div className="mono mb-2.5 text-[10px] tracking-[0.18em] text-console-dim">
            {t("rs.dimensions")}
          </div>
          <div className="grid grid-cols-5 gap-2">
            {(
              [
                [t("rs.d1"), reportA.report.dimensions.interests],
                [t("rs.d2"), reportA.report.dimensions.values],
                [t("rs.d3"), reportA.report.dimensions.lifestyle],
                [t("rs.d4"), reportA.report.dimensions.communication],
                [t("rs.d5"), reportA.report.dimensions.intent],
              ] as const
            ).map(([label, v]) => (
              <div key={label}>
                <div className="flex gap-[2px]">
                  {Array.from({ length: 10 }).map((_, k) => (
                    <span
                      key={k}
                      className="h-1.5 flex-1"
                      style={{
                        background:
                          k < Math.round(v / 10)
                            ? segColor(v)
                            : "var(--console-soft)",
                      }}
                    />
                  ))}
                </div>
                <div className="mono mt-1.5 text-[9px] tracking-wider text-console-dim">
                  {label} {v}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
