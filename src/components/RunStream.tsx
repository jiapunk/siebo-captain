"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import type { RunEvent } from "@/lib/types";

export default function RunStream({
  runId,
  other,
  onDone,
}: {
  runId: string;
  other: { name: string; emoji: string; isBot: boolean };
  onDone?: () => void;
}) {
  const t = useT();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [closed, setClosed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const doneFired = useRef(false);

  useEffect(() => {
    const es = new EventSource(`/api/agent/runs/${runId}/stream`);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string;
          event?: RunEvent;
          status?: string;
        };
        if (msg.type === "event" && msg.event) {
          setEvents((prev) => [...prev, msg.event as RunEvent]);
          if (msg.event.type === "done" && !doneFired.current) {
            doneFired.current = true;
            setClosed(true);
            es.close();
            onDone?.();
          }
        } else if (msg.type === "ready" && msg.status !== "running") {
          setClosed(true);
          es.close();
          onDone?.();
        } else if (msg.type === "closed") {
          setClosed(true);
          es.close();
        }
      } catch {}
    };
    es.onerror = () => {
      setClosed(true);
      es.close();
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events]);

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
          CAPTAIN LINK {"// "}{closed ? "ARCHIVED" : t("agent.live")}
        </span>
        <span className="mono ml-auto text-[11px] tracking-wider text-console-dim">
          {other.name.toUpperCase()} {"// "}{events.length} SIGNALS
        </span>
      </div>

      <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
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
                    {isA ? "YOUR CAPTAIN" : t("rs.captainOf", { name: other.name })} {t("rs.report")}
                  </span>
                  <span className="flex items-center gap-2">
                    {r.decisionSource && (
                      <span className="mono border border-console-soft px-1.5 py-0.5 text-[9px] tracking-[0.16em] text-console-dim">
                        ENGINE {"//"} {r.decisionSource.toUpperCase()}
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
        <div ref={bottomRef} />
      </div>

      {reportA && (
        <div className="mt-4 border-t border-console-soft pt-4">
          <div className="mono mb-2.5 text-[10px] tracking-[0.18em] text-console-dim">
            DIMENSIONS {"// "}{t("rs.dimensions").split("// ")[1] || "評分維度"}
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
