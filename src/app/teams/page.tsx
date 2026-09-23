"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ScoreRing from "@/components/ScoreRing";
import { IconUsers, IconArrowRight } from "@/components/Icons";
import { api, useMe, useUserBus } from "@/lib/client";
import { apiErrorMessage, useI18n } from "@/lib/i18n";
import type { TeamReport } from "@/lib/types";
import type { Locale } from "@/lib/i18n-dict";

const INTL_LOCALE: Record<Locale, string> = { zh: "zh-Hant", cn: "zh-Hans", en: "en", ja: "ja" };

/** 相對時間（依目前語系；client.tsx 的 timeAgo 只有繁中） */
function ago(iso: string, locale: Locale): string {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(0, "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

interface Member {
  userId: string;
  name: string;
  emoji: string;
  isBot: boolean;
  role: string;
  accepted: boolean;
  isMe: boolean;
}

interface ConnRow {
  id: string;
  status: string;
  /** requested 時：outgoing＝我發出的邀請、incoming＝對方邀請我；connected 為 null */
  direction: "outgoing" | "incoming" | null;
  other: { id: string; name: string; emoji: string };
  lastMessage: { content: string } | null;
}

interface TeamRow {
  id: string;
  status: "proposed" | "assembled";
  score: number;
  report: TeamReport | null;
  createdAt: string;
  lastMessage: { content: string; senderId: string } | null;
  members: Member[];
}

export default function TeamsPage() {
  const { me, loading } = useMe();
  const router = useRouter();
  const { t: tr, locale } = useI18n();
  const [teams, setTeams] = useState<TeamRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 各隊伍／聯絡的錯誤（存原始錯誤，顯示時才翻譯）
  const [errors, setErrors] = useState<Record<string, unknown>>({});
  const [loadError, setLoadError] = useState<unknown>(null);
  const [swarm, setSwarm] = useState<{
    hypotheses: number;
    selected: number;
    failed: number;
    providers: string[];
  } | null>(null);
  const [network, setNetwork] = useState<{
    mode: string;
    nodes: { id: string; name: string; emoji: string; role: string; isBot: boolean; competence: number; degree: number }[];
    edges: [string, string][];
    metrics: { edges: number; avgDegree: number; clustering: number; hubs: { id: string; name: string; degree: number }[] };
    sim: null | {
      social: { edges: number; clustering: number; crossGroup: number };
      competence: { edges: number; clustering: number; crossGroup: number };
      hypotheses: number;
    };
  } | null>(null);
  const [conns, setConns] = useState<ConnRow[]>([]);

  const load = useCallback(() => {
    api<{
      teams: TeamRow[];
      swarm?: {
        hypotheses: number;
        selected: number;
        failed: number;
        providers: string[];
      };
    }>("/api/teams")
      .then((d) => {
        setTeams(d.teams);
        setSwarm(d.swarm ?? null);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e));
    api<Parameters<typeof setNetwork>[0]>("/api/network")
      .then((d) => setNetwork(d))
      .catch(() => {});
    // email 未驗證時 403：頁首已有驗證橫幅，這裡不重複提示
    api<{ connections: ConnRow[] }>("/api/connections")
      .then((d) => setConns(d.connections))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading && !me) router.replace("/");
    if (me) load();
  }, [me, loading, load, router]);

  // 只在伺服器狀態真的變了（refresh）時重抓；忽略互盤時每秒數十個 part 事件
  useUserBus((evt) => {
    if (evt.type === "refresh" || evt.type === "ready") load();
  });

  const setError = (key: string, e: unknown) =>
    setErrors((prev) => {
      const next = { ...prev };
      if (e == null) delete next[key];
      else next[key] = e;
      return next;
    });

  /** 加入＝本人同意；所有真人都同意才成立（回 proposed 時代表還在等隊友） */
  async function join(id: string) {
    setBusy(id);
    setError(id, null);
    try {
      await api<{ status: string; pending: string[] }>(`/api/teams/${id}`, {
        method: "POST",
      });
      load();
    } catch (e) {
      setError(id, e);
    } finally {
      setBusy(null);
    }
  }

  async function acceptConn(id: string) {
    setBusy(id);
    setError(id, null);
    try {
      await api(`/api/connections/${id}/accept`, { method: "POST" });
      load();
    } catch (e) {
      setError(id, e);
    } finally {
      setBusy(null);
    }
  }

  if (!me)
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 items-center justify-center p-8 text-muted">
          {loading ? "…" : tr("identity.select")}
        </main>
      </>
    );

  const proposals = teams?.filter((x) => x.status === "proposed") ?? [];
  const assembled = teams?.filter((x) => x.status === "assembled") ?? [];

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl flex-1 px-4 pb-16">
        <div className="cut mt-6 sm:mt-8">
          <div className="ticks-x" />
          <div className="p-5">
            <div className="tag flex items-center gap-2">
              <span className="led led-live" />
              {tr("teams.tag")}
            </div>
            <h1 className="font-display mt-1.5 text-xl font-black">
              {tr("teams.title")}
            </h1>
            <p className="mt-1 text-sm text-muted">{tr("teams.desc")}</p>
            {swarm && (
              <div className="mono mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] tracking-wider">
                <span className="text-phos">
                  SWARM {"//"} HYPOTHESES {swarm.hypotheses}
                </span>
                <span className="text-muted">SELECTED {swarm.selected}</span>
                {swarm.failed > 0 && (
                  <span className="text-amber">FAILED {swarm.failed}</span>
                )}
                {swarm.providers.length > 0 && (
                  <span className="text-muted">
                    ENGINE {swarm.providers.map((x) => x.toUpperCase()).join("+")}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {!teams && (
          <div className="cut mt-4 p-8 text-center text-muted">
            {loadError != null ? (
              <span role="alert" className="text-sm text-amber">
                {apiErrorMessage(tr, loadError)}
              </span>
            ) : (
              "…"
            )}
          </div>
        )}

        {teams && teams.length === 0 && (
          <div className="cut mt-4 p-10 text-center text-muted">
            <span className="mono text-xs tracking-wider">
              {tr("teams.empty")}
            </span>
            <br />
            <span className="mt-2 inline-block text-sm">
              {tr("teams.empty1")}{" "}
              <Link
                href="/agent"
                className="text-phos underline underline-offset-2"
              >
                {tr("teams.emptyLink")}
              </Link>{" "}
              {tr("teams.empty2")}
            </span>
          </div>
        )}

        {/* 候選隊伍 */}
        {proposals.map((cand, idx) => {
          const mine = cand.members.find((m) => m.isMe);
          const waiting = cand.members.filter((m) => !m.accepted);
          return (
          <div key={cand.id} className="cut rise-in mt-4">
            <div className="flex items-center gap-3 border-b border-line bg-panel-2/60 px-5 py-3">
              <span className="flex h-8 w-8 items-center justify-center border border-line bg-panel-2 text-phos">
                <IconUsers size={15} />
              </span>
              <span className="tag">
                {tr("teams.proposal")} {"//"} #{String(idx + 1).padStart(2, "0")}
              </span>
              <span className="ml-auto">
                <ScoreRing score={cand.score} size={50} label={tr("teams.score")} />
              </span>
            </div>

            <div className="p-5">
              {/* 成員 */}
              <div className="mb-4 grid gap-2 sm:grid-cols-3">
                {cand.members.map((m) => (
                  <div
                    key={m.userId}
                    className={`flex items-center gap-2.5 border p-2.5 ${
                      m.isMe
                        ? "border-alert bg-alert-soft"
                        : "border-line bg-panel-2"
                    }`}
                  >
                    <span className="flex h-9 w-9 items-center justify-center border border-line bg-base text-lg">
                      {m.emoji}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">
                        {m.name}
                        {m.isMe && (
                          <span className="mono ml-1.5 text-[9px] text-alert">
                            YOU
                          </span>
                        )}
                      </span>
                      <span className="mono block text-[10px] tracking-wider text-muted">
                        {m.role}
                        {m.isBot ? " // SIM" : ""}
                      </span>
                      {/* 組隊同意狀態：模擬隊友視為已同意；真人要自己按「加入這隊」 */}
                      <span
                        className={`mono block text-[10px] tracking-wider ${
                          m.accepted ? "text-phos" : "text-amber"
                        }`}
                      >
                        {m.isBot
                          ? tr("b.team.botAccepted")
                          : m.accepted
                            ? tr("b.team.accepted")
                            : tr("b.team.pending")}
                      </span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="mb-3 flex flex-wrap gap-1.5">
                {cand.report?.coverage.map((c) => (
                  <span key={c} className="chip">
                    {c}
                  </span>
                ))}
              </div>

              <ul className="space-y-1.5 text-sm text-ink-soft">
                {cand.report?.rationale.map((r, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mono mt-0.5 shrink-0 text-[11px] font-bold text-phos">
                      +
                    </span>
                    {r}
                  </li>
                ))}
              </ul>
              {cand.report?.risks.map((r, i) => (
                <p key={i} className="mt-1.5 flex gap-2.5 text-xs text-amber">
                  <span className="mono shrink-0 font-bold">!</span>
                  {tr("teams.risk", { t: r })}
                </p>
              ))}
            </div>

            <div className="border-t border-line bg-panel-2/40 p-3">
              {mine?.accepted ? (
                <p role="status" className="py-2 text-center text-sm text-ink-soft">
                  {tr("b.team.waitingFor", {
                    names: waiting.map((m) => m.name).join(tr("b.listSep")) || "—",
                  })}
                </p>
              ) : (
                <button
                  onClick={() => join(cand.id)}
                  disabled={busy === cand.id}
                  className="btn btn-accent w-full text-sm"
                >
                  {busy === cand.id ? tr("teams.joining") : tr("teams.join")}
                </button>
              )}
              {errors[cand.id] != null && (
                <p role="alert" className="mt-2 text-center text-xs text-amber">
                  {apiErrorMessage(tr, errors[cand.id])}
                </p>
              )}
            </div>
          </div>
          );
        })}

        {/* 已成立 */}
        {assembled.length > 0 && (
          <div className="tag mt-10 mb-3">{tr("teams.deployed")}</div>
        )}
        {assembled.map((cand) => (
          <Link
            key={cand.id}
            href={`/team/${cand.id}`}
            className="cut rise-in mb-3 flex items-center gap-4 p-4 transition hover:border-phos"
          >
            <span className="flex -space-x-2">
              {cand.members.slice(0, 3).map((m) => (
                <span
                  key={m.userId}
                  className="flex h-10 w-10 items-center justify-center border border-line bg-base text-lg"
                >
                  {m.emoji}
                </span>
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">
                {cand.members.map((m) => m.name).join(tr("b.listSep"))}
              </span>
              <span className="mono mt-0.5 block truncate text-[10px] tracking-wider text-muted">
                {cand.lastMessage
                  ? `${tr("teams.last")}${cand.lastMessage.content.slice(0, 30)}`
                  : `${tr("teams.enter")} // ${ago(cand.createdAt, locale)}`}
              </span>
            </span>
            <ScoreRing score={cand.score} size={44} />
            <IconArrowRight size={16} className="text-muted" />
          </Link>
        ))}

        {/* 合作網絡（P2） */}
        {network && network.nodes.length >= 3 && (
          <div className="cut mt-10">
            <div className="ticks-x" />
            <div className="p-5">
              <div className="tag flex items-center gap-2">
                <span className="led led-live" />
                NETWORK {"//"} {tr("b.net.title")}
                <span className="border border-line px-1.5 py-0.5 text-[9px]">
                  SIGNAL: {network.mode.toUpperCase()}
                </span>
              </div>

              {/* 圖 */}
              <div className="mt-4 flex justify-center">
                <svg
                  viewBox="0 0 360 360"
                  className="h-72 w-72"
                  role="img"
                  aria-label={tr("b.net.title")}
                >
                  {network.edges.map(([a, b], i) => {
                    const pos = (id: string) => {
                      const idx = network.nodes.findIndex((n) => n.id === id);
                      const ang =
                        (idx / Math.max(1, network.nodes.length)) * Math.PI * 2 -
                        Math.PI / 2;
                      return [180 + Math.cos(ang) * 130, 180 + Math.sin(ang) * 130];
                    };
                    const [x1, y1] = pos(a);
                    const [x2, y2] = pos(b);
                    return (
                      <line
                        key={i}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke="rgba(91,227,167,0.35)"
                        strokeWidth={1}
                      />
                    );
                  })}
                  {network.nodes.map((n, i) => {
                    const ang =
                      (i / Math.max(1, network.nodes.length)) * Math.PI * 2 -
                      Math.PI / 2;
                    const x = 180 + Math.cos(ang) * 130;
                    const y = 180 + Math.sin(ang) * 130;
                    const r = 6 + Math.min(10, n.degree * 2.5);
                    const isMe = n.id === me?.id;
                    return (
                      <g key={n.id}>
                        <circle
                          cx={x}
                          cy={y}
                          r={r}
                          fill={isMe ? "#ff5c38" : n.degree > 1 ? "#5be3a7" : "#26353b"}
                          stroke="#070c0f"
                          strokeWidth={1.5}
                        />
                        {(isMe || n.degree >= 2) && (
                          <text
                            x={x}
                            y={y - r - 5}
                            textAnchor="middle"
                            fontSize={9}
                            fill="#9fb3b3"
                            fontFamily="monospace"
                          >
                            {n.name}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* 指標 */}
              <div className="mono mt-3 grid grid-cols-3 gap-2 text-center text-[10px] tracking-wider">
                <div className="border border-line p-2">
                  CLUSTERING
                  <div className="text-sm text-phos">{network.metrics.clustering}</div>
                </div>
                <div className="border border-line p-2">
                  EDGES / AVG° 
                  <div className="text-sm text-ink">
                    {network.metrics.edges} / {network.metrics.avgDegree}
                  </div>
                </div>
                <div className="border border-line p-2">
                  HUBS
                  <div className="text-sm text-amber">
                    {network.metrics.hubs.map((h) => h.name).join(tr("b.listSep")) || "—"}
                  </div>
                </div>
              </div>

              {/* 兩種信號模擬對照（EvoX 實驗二） */}
              {network.sim && (
                <div className="mt-3 border border-line bg-panel-2/50 p-3">
                  <div className="tag mb-2">
                    SIGNAL SIMULATION {"//"}{" "}
                    {tr("b.net.simDesc", { n: network.sim.hypotheses })}
                  </div>
                  <div className="mono grid grid-cols-2 gap-2 text-center text-[10px] tracking-wider">
                    <div>
                      {tr("b.net.social")} (SOCIAL)
                      <div className="text-sm text-amber">
                        {network.sim.social.clustering}
                      </div>
                      <div className="text-[9px] text-muted">
                        {tr("b.net.edgesCross", {
                          edges: network.sim.social.edges,
                          cross: network.sim.social.crossGroup,
                        })}
                      </div>
                    </div>
                    <div>
                      {tr("b.net.competence")} (COMPETENCE)
                      <div className="text-sm text-phos">
                        {network.sim.competence.clustering}
                      </div>
                      <div className="text-[9px] text-muted">
                        {tr("b.net.edgesCross", {
                          edges: network.sim.competence.edges,
                          cross: network.sim.competence.crossGroup,
                        })}
                      </div>
                    </div>
                  </div>
                  <p className="mono mt-2 text-[9px] leading-relaxed text-muted">
                    {tr("b.net.simNote")}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 持續聯絡 */}
        {conns.length > 0 && (
          <>
            <div className="tag mt-10 mb-1">{tr("conn.title")}</div>
            <p className="mb-3 text-xs text-muted">{tr("conn.desc")}</p>
            {conns.map((cn) => (
              <div key={cn.id} className="mb-3">
                <div className="flex items-stretch gap-2">
                  <Link
                    href={`/connect/${cn.id}`}
                    className="cut rise-in flex min-w-0 flex-1 items-center gap-4 p-4 transition hover:border-phos"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-line bg-base text-xl">
                      {cn.other.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{cn.other.name}</span>
                      <span className="mono mt-0.5 block truncate text-[10px] tracking-wider text-muted">
                        {cn.lastMessage
                          ? `${tr("teams.last")}${cn.lastMessage.content.slice(0, 30)}`
                          : tr("conn.direct")}
                      </span>
                    </span>
                    <span
                      className={`mono shrink-0 text-[10px] tracking-wider ${
                        cn.status === "connected" ? "text-phos" : "text-amber"
                      }`}
                    >
                      {cn.status === "connected"
                        ? tr("conn.open")
                        : cn.direction === "incoming"
                          ? tr("b.conn.incomingShort")
                          : tr("b.conn.outgoingShort")}
                    </span>
                    <IconArrowRight size={16} className="text-muted" />
                  </Link>
                  {cn.status !== "connected" && cn.direction === "incoming" && (
                    <button
                      onClick={() => acceptConn(cn.id)}
                      disabled={busy === cn.id}
                      className="btn btn-accent shrink-0 px-4 text-sm disabled:opacity-50"
                    >
                      {busy === cn.id ? "…" : tr("b.conn.accept")}
                    </button>
                  )}
                </div>
                {errors[cn.id] != null && (
                  <p role="alert" className="mt-1 text-xs text-amber">
                    {apiErrorMessage(tr, errors[cn.id])}
                  </p>
                )}
              </div>
            ))}
          </>
        )}
      </main>
    </>
  );
}
