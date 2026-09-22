"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import ScoreRing from "@/components/ScoreRing";
import { IconRadar } from "@/components/Icons";
import { api, useMe, useUserBus } from "@/lib/client";
import { useI18n } from "@/lib/i18n";
import { shareCardPng } from "@/lib/card";
import type { IcebreakerCard } from "@/lib/types";

interface Person {
  userId: string;
  runId: string;
  name: string;
  emoji: string;
  score: number;
  band?: "priority" | "watch";
  role: string;
  skills: string[];
  goal: string;
  availability: string;
  summaryForUser: string;
  sharedTopics: string[];
  card: IcebreakerCard | null;
}

export default function PeoplePage() {
  const { me, loading } = useMe();
  const { t } = useI18n();
  const router = useRouter();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [cards, setCards] = useState<Record<string, IcebreakerCard>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [conns, setConns] = useState<Record<string, { id: string; status: string }>>({});
  const [connecting, setConnecting] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ people: Person[] }>("/api/people")
      .then((d) => {
        setPeople(d.people);
        const initial: Record<string, IcebreakerCard> = {};
        for (const p of d.people) if (p.card) initial[p.userId] = p.card;
        setCards(initial);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading && !me) router.replace("/");
    if (me) load();
  }, [me, loading, load, router]);

  const loadConns = useCallback(() => {
    api<{ connections: { id: string; status: string; other: { id: string } }[] }>(
      "/api/connections",
    )
      .then((d) => {
        const m: Record<string, { id: string; status: string }> = {};
        for (const c of d.connections) m[c.other.id] = { id: c.id, status: c.status };
        setConns(m);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (me) loadConns();
  }, [me, loadConns]);

  useUserBus(load);

  async function keepInTouch(userId: string) {
    setConnecting(userId);
    try {
      const res = await api<{ id: string; status: string }>("/api/connections", {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      setConns((prev) => ({ ...prev, [userId]: res }));
    } finally {
      setConnecting(null);
    }
  }

  async function generate(userId: string) {
    setBusy(userId);
    try {
      const { card } = await api<{ card: IcebreakerCard }>(
        `/api/people/${userId}/icebreakers`,
        { method: "POST" },
      );
      setCards((prev) => ({ ...prev, [userId]: card }));
    } catch {
      // 忽略：可能未互盤完成
    } finally {
      setBusy(null);
    }
  }

  async function exportCard(p: Person) {
    const card = cards[p.userId];
    if (!card || exporting) return;
    setExporting(p.userId);
    try {
      await shareCardPng(
        {
          name: p.name,
          emoji: p.emoji,
          role: p.role,
          score: p.score,
          shared: card.shared,
          complement: card.complement,
          risk: card.risk,
          openers: card.openers,
          labels: {
            brief: t("card.brief"),
            subtitle: t("card.subtitle"),
            compat: t("card.compat"),
            openers: t("card.openers"),
            openersHint: t("card.openersHint"),
            ready: t("card.ready"),
          },
        },
        `siebo-card-${p.name}.png`,
      );
    } finally {
      setExporting(null);
    }
  }

  async function copyOpener(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
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

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl flex-1 px-4 pb-16">
        {/* 標頭 */}
        <div className="card cut mt-8 mb-5">
          <div className="ticks-x" />
          <div className="flex items-start justify-between gap-4 p-5">
            <div>
              <div className="tag flex items-center gap-2">
                <span className="led led-live" />
                RADAR {"// "}{t("radar.tag").split("// ")[1]}
              </div>
              <h1 className="font-display mt-1.5 text-xl font-black">
                {t("radar.title")}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {t("radar.desc")}
              </p>
            </div>
            <Link href="/agent" className="btn btn-outline px-4 py-2 text-sm">
              {t("radar.viewAgent")}
            </Link>
          </div>
        </div>

        {!people && (
          <div className="card cut p-8 text-center text-muted">載入中…</div>
        )}

        {people && people.length === 0 && (
          <div className="card cut p-10 text-center text-muted">
            <span className="mono text-xs tracking-wider">
              {t("radar.empty")}
            </span>
            <br />
            <span className="mt-2 inline-block text-sm">
              {t("radar.empty1")}{" "}
              <Link
                href="/agent"
                className="text-accent underline underline-offset-2"
              >
                {t("radar.emptyLink")}
              </Link>{" "}
              {t("radar.empty2")}
            </span>
          </div>
        )}

        {people && people.length > 0 && (
          <div className="tag mb-3">CONTACTS {"// "}{people.length} 個訊號</div>
        )}

        {people?.map((p, idx) => {
          const card = cards[p.userId];
          return (
            <div key={p.userId} className="card cut rise-in mb-4">
              {/* 目標列 */}
              <div className="relative flex items-center gap-4 p-5">
                <span className="mono absolute top-3 right-4 text-[10px] tracking-[0.18em] text-muted">
                  TGT-{String(idx + 1).padStart(2, "0")}
                </span>
                <span className="relative flex h-12 w-12 shrink-0 items-center justify-center border border-line-strong bg-base text-2xl">
                  {p.emoji}
                  {/* 準星角標 */}
                  <span className="absolute -top-1.5 -left-1.5 h-2.5 w-2.5 border-t-2 border-l-2 border-accent" />
                  <span className="absolute -bottom-1.5 -right-1.5 h-2.5 w-2.5 border-b-2 border-r-2 border-accent" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display font-black">{p.name}</span>
                    <span className="mono border border-line-strong px-1.5 py-0.5 text-[10px] tracking-wider">
                      {p.role}
                    </span>
                    <span className="mono border border-accent px-1.5 py-0.5 text-[10px] tracking-wider text-accent-deep">
                      {t("radar.worth")}
                    </span>
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-soft">
                    {p.summaryForUser}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.skills.map((s) => (
                      <span key={s} className="chip">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="hidden shrink-0 sm:block">
                  <ScoreRing score={p.score} size={58} label="互補" />
                </div>
              </div>

              {/* 破冰卡 */}
              {card ? (
                <div className="border-t-[1.5px] border-line-strong bg-panel-2/60 p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="tag">BRIEFING {"// "}{t("radar.briefing").split("// ")[1]}</span>
                    <span className="stamp text-phos">{t("radar.ready")}</span>
                  </div>

                  <div className="space-y-2 text-sm">
                    {card.shared.length > 0 && (
                      <div className="flex gap-3">
                        <span className="mono w-12 shrink-0 pt-0.5 text-[10px] tracking-wider text-sage">
                          {t("radar.shared")}
                        </span>
                        <span className="text-ink-soft">
                          {card.shared.join("、")}
                        </span>
                      </div>
                    )}
                    {card.complement.map((c, i) => (
                      <div key={i} className="flex gap-3">
                        <span className="mono w-12 shrink-0 pt-0.5 text-[10px] tracking-wider text-accent-deep">
                          {t("radar.complement")}
                        </span>
                        <span className="text-ink-soft">{c}</span>
                      </div>
                    ))}
                    <div className="flex gap-3">
                      <span className="mono w-12 shrink-0 pt-0.5 text-[10px] tracking-wider text-amber">
                        {t("radar.watchout")}
                      </span>
                      <span className="text-ink-soft">{card.risk}</span>
                    </div>
                  </div>

                  <div className="mt-4 mb-2 flex items-center justify-between">
                    <span className="tag">
                      {t("radar.openers")}
                    </span>
                    <button
                      onClick={() => exportCard(p)}
                      disabled={exporting === p.userId}
                      className="btn btn-outline px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      {exporting === p.userId ? t("radar.exporting") : t("radar.export")}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {card.openers.map((o, i) => (
                      <button
                        key={i}
                        onClick={() => copyOpener(o, `${p.userId}-${i}`)}
                        className="group flex w-full items-start gap-3 border border-line bg-panel-2 p-3 text-left text-sm leading-relaxed transition hover:border-line-strong"
                      >
                        <span className="mono mt-0.5 shrink-0 text-[11px] font-bold text-accent">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1">{o}</span>
                        <span className="mono shrink-0 text-[10px] tracking-wider text-muted">
                          {copied === `${p.userId}-${i}` ? t("radar.copied") : t("radar.copy")}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* 保持聯絡 */}
                  <div className="mt-4 flex items-center gap-2 border-t border-line pt-4">
                    {conns[p.userId] ? (
                      <>
                        <span className="mono text-[11px] tracking-wider text-phos">
                          {t("conn.kept")}
                        </span>
                        {conns[p.userId].status === "connected" && (
                          <Link
                            href={`/connect/${conns[p.userId].id}`}
                            className="btn btn-outline ml-auto px-4 py-2 text-xs"
                          >
                            {t("conn.open")}
                          </Link>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="line-clamp-1 text-xs text-muted">
                          {t("conn.desc")}
                        </span>
                        <button
                          onClick={() => keepInTouch(p.userId)}
                          disabled={connecting === p.userId}
                          className="btn btn-ink ml-auto shrink-0 px-4 py-2 text-xs disabled:opacity-50"
                        >
                          {connecting === p.userId ? "…" : t("conn.keep")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 border-t-[1.5px] border-line-strong bg-panel-2/60 p-3">
                  <button
                    onClick={() => generate(p.userId)}
                    disabled={busy === p.userId}
                    className="btn btn-accent flex-1 py-2.5 text-sm disabled:opacity-60"
                  >
                    {busy === p.userId ? t("radar.generating") : t("radar.generate")}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {people && people.length > 0 && (
          <p className="mono mt-6 text-center text-[11px] tracking-wider text-muted">
            {t("radar.footer")}{" //"}
            <Link
              href="/teams"
              className="ml-1.5 text-accent underline underline-offset-2"
            >
              {t("radar.footerLink")}
            </Link>
          </p>
        )}
      </main>
    </>
  );
}
