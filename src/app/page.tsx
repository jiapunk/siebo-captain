"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, useMe } from "@/lib/client";
import { IconArrowRight, IconPlus } from "@/components/Icons";
import { useI18n } from "@/lib/i18n";
import LocaleSwitcher from "@/components/LocaleSwitcher";

interface UserRow {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  isBot: boolean;
  profileStatus: string;
}

export default function Home() {
  const router = useRouter();
  const { me, llmMode } = useMe();
  const { t } = useI18n();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [eventName, setEventName] = useState("");
  const [eventCodeDb, setEventCodeDb] = useState("");
  const [name, setName] = useState("");
  const [eventCode, setEventCode] = useState("EVOTAVERN");
  const [eventLive, setEventLive] = useState<{
    live: boolean;
    day: number;
    totalDays: number | null;
  } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<{ users: UserRow[] }>("/api/users").then((d) => setUsers(d.users));
    api<{
      event: {
        name: string;
        code: string;
        live: boolean;
        day: number;
        totalDays: number | null;
      } | null;
    }>("/api/events/current")
      .then((d) => {
        setEventName(d.event?.name ?? "");
        setEventCodeDb(d.event?.code ?? "");
        if (d.event?.code) setEventCode(d.event.code);
        if (d.event)
          setEventLive({
            live: d.event.live,
            day: d.event.day,
            totalDays: d.event.totalDays,
          });
      })
      .catch(() => {});
  }, []);

  async function enter(id: string, status: string) {
    await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ userId: id }),
    });
    router.push(status === "ready" ? "/agent" : "/onboarding");
  }

  async function createIdentity() {
    if (!name.trim() || creating) return;
    setCreateError(null);
    setCreating(true);
    try {
      const emojis = ["🚀", "⚡", "🧩", "🛠️", "🦾", "🎯", "🧠", "🔥"];
      const { id } = await api<{ id: string }>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          emoji: emojis[Math.floor(Math.random() * emojis.length)],
          eventCode: eventCode.trim() || undefined,
        }),
      });
      await api("/api/session", {
        method: "POST",
        body: JSON.stringify({ userId: id }),
      });
      router.push("/onboarding");
    } catch (e) {
      const m = (e as Error).message;
      setCreateError(
        m === "invalid_event_code"
          ? t("landing.errCode", { code: eventCodeDb || "EVOTAVERN" })
          : t("landing.errCreate"),
      );
    } finally {
      setCreating(false);
    }
  }

  const steps = [
    { n: "01", t: t("landing.step1t"), d: t("landing.step1d") },
    { n: "02", t: t("landing.step2t"), d: t("landing.step2d") },
    { n: "03", t: t("landing.step3t"), d: t("landing.step3d") },
  ];

  return (
    <main className="relative mx-auto max-w-4xl flex-1 px-4 pb-20">
      {/* 直書日文裝飾（桌機） */}
      <div className="vertical-jp absolute top-40 right-1 hidden text-sm lg:block">
        攻殻機動隊・電脳空間
      </div>

      {/* 狀態列 */}
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border border-line bg-console px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className="led led-live" />
          <span className="mono text-[11px] tracking-[0.18em] text-phos">
            LIVE
          </span>
          <span className="flex items-end gap-[2px]">
            <span className="wave-bar" />
            <span className="wave-bar" />
            <span className="wave-bar" />
            <span className="wave-bar" />
          </span>
        </span>
        <span className="mono text-[11px] tracking-wider text-muted">
          EVENT {"// "}
          {eventName || "—"}
        </span>
        <span className="mono hidden text-[11px] tracking-wider text-muted sm:inline">
          CODE {"// "}
          {eventCodeDb || "—"}
        </span>
        {eventLive?.live && (
          <span className="mono hidden text-[11px] tracking-wider text-phos sm:inline">
            DAY {eventLive.day}
            {eventLive.totalDays ? `/${eventLive.totalDays}` : ""} · LIVE
          </span>
        )}
        <span className="mono ml-auto hidden text-[11px] tracking-wider text-muted sm:inline">
          {llmMode === "real" ? "MODEL // DEEPSEEK" : "MODE // SANDBOX"}
        </span>
        <span className="ml-auto sm:ml-0">
          <LocaleSwitcher />
        </span>
      </div>

      {/* Hero */}
      <section className="rise-in mt-10 mb-12">
        <div className="tag mb-4 flex items-center gap-3">
          <span className="inline-block h-[2px] w-8 bg-phos" />
          MISSION BRIEF {"// "}
          {t("landing.brief")}
        </div>
        <h1 className="font-display max-w-2xl text-4xl leading-tight font-black sm:text-[3.2rem] sm:leading-[1.12]">
          {t("landing.title1")}
          <br />
          {t("landing.title2")}
          <span className="relative mx-1 inline-block bg-alert px-2 text-white">
            {t("landing.highlight")}
          </span>
          <span className="text-phos">。</span>
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink-soft">
          {t("landing.desc")}
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {me && (
            <button
              onClick={() => enter(me.id, me.profileStatus)}
              className="btn btn-accent"
            >
              {me.profileStatus === "ready"
                ? t("landing.enter")
                : t("landing.continue")}
              <IconArrowRight size={17} />
            </button>
          )}
          <Link href="/login" className="btn btn-outline">
            {t("landing.login")}
          </Link>
        </div>
      </section>

      {/* 步驟 */}
      <section className="mb-14">
        <div className="tag mb-4">
          PROTOCOL {"// "}
          {t("landing.protocol")}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="cut p-5">
              <div className="ticks-x absolute inset-x-0 top-0" />
              <div className="mono pt-1 text-[11px] tracking-[0.2em] text-alert">
                STEP {s.n}
              </div>
              <div className="mt-2.5 font-bold">{s.t}</div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 名冊 */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <div className="tag">
            ROSTER {"// "}
            {t("landing.roster")}
          </div>
          <span className="mono hidden text-[10px] tracking-wider text-muted sm:inline">
            {t("landing.rosterHint")}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => enter(u.id, u.profileStatus)}
              className="cut group flex items-center gap-4 p-4 text-left transition hover:border-phos"
            >
              <span className="reticle flex h-12 w-12 shrink-0 items-center justify-center border border-line bg-base text-2xl">
                {u.emoji}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-bold">{u.name}</span>
                  <span className="mono border border-line px-1.5 py-0.5 text-[9px] tracking-wider text-muted">
                    {u.isBot ? "SIM" : "DEMO"}
                  </span>
                </span>
                <span className="mono mt-1 block line-clamp-2 text-[11px] leading-relaxed text-muted">
                  {u.tagline}
                </span>
              </span>
              <IconArrowRight
                size={16}
                className="shrink-0 text-muted opacity-0 transition group-hover:text-phos group-hover:opacity-100"
              />
            </button>
          ))}

          {/* 建立新身分 */}
          <div className="cut sm:col-span-2">
            <div className="ticks-x" />
            <div className="p-5">
              <div className="tag mb-3">
                ENLIST {"// "}
                {t("landing.enlist")}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("landing.name")}
                  maxLength={12}
                  className="min-w-40 flex-1 border border-line bg-base px-4 py-2.5 text-sm outline-none placeholder:text-muted/70 focus:border-phos"
                />
                <input
                  value={eventCode}
                  onChange={(e) => setEventCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && createIdentity()}
                  placeholder={t("landing.eventCode")}
                  maxLength={16}
                  className="mono w-36 border border-line bg-base px-4 py-2.5 text-sm tracking-wider outline-none placeholder:text-muted/70 focus:border-phos"
                />
                <button
                  onClick={createIdentity}
                  disabled={!name.trim() || creating}
                  className="btn btn-ink"
                >
                  <IconPlus size={15} />
                  {t("landing.start")}
                </button>
              </div>
              {createError && (
                <div className="mt-3 border border-alert bg-alert-soft p-2.5 text-xs text-ink-soft">
                  {createError}
                </div>
              )}
              <div className="mono mt-3 text-[11px] text-muted">
                {t("landing.enlistHint", {
                  code: eventCodeDb || "EVOTAVERN",
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <p className="mono mt-14 text-center text-[11px] tracking-wider text-muted">
        {llmMode === "real"
          ? t("landing.footerReal")
          : llmMode === "hybrid"
            ? t("landing.footerHybrid")
            : llmMode === "mock"
              ? t("landing.footerMock")
              : "\u00a0"}
      </p>
    </main>
  );
}
