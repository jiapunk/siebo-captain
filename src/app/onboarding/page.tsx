"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { IconArrowRight, IconCompass } from "@/components/Icons";
import { api, useMe } from "@/lib/client";
import { useI18n } from "@/lib/i18n";
import { CONTENT } from "@/lib/content";

interface Turn {
  role: "agent" | "user";
  content: string;
  ts: number;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { me } = useMe();
  const { t: tr, locale } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ profile: { status: string; interview: Turn[] | null } }>("/api/profile")
      .then(({ profile }) => {
        if (profile.status === "ready") {
          router.replace("/profile");
          return;
        }
        const history = profile.interview ?? [];
        if (history.length === 0) {
          setTurns([
            {
              role: "agent",
              content: CONTENT[locale].interview[0],
              ts: Date.now(),
            },
          ]);
        } else {
          setTurns(history);
          const userCount = history.filter((t) => t.role === "user").length;
          setDone(userCount >= 6);
        }
      })
      .catch(() => router.replace("/"));
  }, [router, locale]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, thinking]);

  async function send() {
    const content = input.trim();
    if (!content || thinking || done) return;
    setInput("");
    setTurns((t) => [...t, { role: "user", content, ts: Date.now() }]);
    setThinking(true);
    try {
      const res = await api<{ reply: string; done: boolean }>(
        "/api/onboarding/message",
        { method: "POST", body: JSON.stringify({ content }) },
      );
      setTurns((t) => [
        ...t,
        { role: "agent", content: res.reply, ts: Date.now() },
      ]);
      if (res.done) setDone(true);
    } catch (e) {
      if ((e as Error).message === "already_compiled")
        router.replace("/profile");
    } finally {
      setThinking(false);
    }
  }

  async function compile() {
    setCompiling(true);
    try {
      await api("/api/onboarding/compile", { method: "POST" });
      router.push("/profile?compiled=1");
    } catch {
      setCompiling(false);
    }
  }

  const progress = Math.min(6, turns.filter((t) => t.role === "user").length);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-6">
        {/* 標頭 */}
        <div className="card cut mt-8 mb-4">
          <div className="ticks-x" />
          <div className="p-5">
            <div className="tag flex items-center gap-2">
              <span className="led led-live" />
              DEBRIEF {"// "}{tr("onb.tag")}
              {me && <span className="text-muted">{"// "}{me.name}</span>}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex flex-1 gap-[3px]">
                {Array.from({ length: 6 }).map((_, i) => (
                  <span
                    key={i}
                    className="h-2 flex-1"
                    style={{
                      background:
                        i < progress ? "var(--accent)" : "var(--line)",
                    }}
                  />
                ))}
              </div>
              <span className="mono text-[11px] tracking-wider text-muted">
                {progress}/6
              </span>
            </div>
          </div>
        </div>

        {/* 對話 */}
        <div
          className="card cut flex-1 overflow-y-auto p-5"
          style={{ minHeight: "50vh" }}
        >
          {turns.map((t, i) => (
            <div
              key={i}
              className={`rise-in mb-4 flex ${t.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={`max-w-[85%] ${t.role === "user" ? "text-right" : ""}`}>
                <div className="mono mb-1 text-[9px] tracking-[0.16em] text-muted">
                  {t.role === "user" ? tr("onb.you") : tr("onb.captain")}
                </div>
                <div
                  className={`inline-block border px-4 py-2.5 text-left text-sm leading-relaxed ${
                    t.role === "user"
                      ? "border-phos bg-phos text-[#04211a]"
                      : "border-line bg-panel-2 text-ink-soft"
                  }`}
                  style={
                    t.role === "agent"
                      ? { borderLeftWidth: 3, borderLeftColor: "var(--accent)" }
                      : undefined
                  }
                >
                  {t.content}
                </div>
              </div>
            </div>
          ))}
          {thinking && (
            <div className="mb-4 flex flex-col items-start">
              <div className="mono mb-1 flex items-center gap-2 text-[9px] tracking-[0.16em] text-muted">
                <span className="led led-live" />
                {tr("onb.typing")}
              </div>
              <div className="flex gap-1 border border-line bg-panel-2 px-4 py-3">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {done ? (
          <button
            onClick={compile}
            disabled={compiling}
            className="btn btn-accent mt-4 w-full py-3.5 disabled:opacity-60"
          >
            {compiling ? tr("onb.compiling") : tr("onb.compile")}
            {!compiling && <IconArrowRight size={17} />}
          </button>
        ) : (
          <div className="mt-4 flex gap-2">
            <div className="flex flex-1 items-center border border-line-strong bg-panel-2">
              <span className="mono pl-3 text-sm font-bold text-accent">
                {">"}
              </span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !e.nativeEvent.isComposing && send()
                }
                placeholder={tr("onb.placeholder")}
                disabled={thinking}
                className="min-w-0 flex-1 bg-transparent px-2.5 py-3 text-sm outline-none placeholder:text-muted/70"
              />
            </div>
            <button
              onClick={send}
              disabled={!input.trim() || thinking}
              className="btn btn-ink px-6 disabled:opacity-40"
            >
              {tr("onb.send")}
            </button>
          </div>
        )}
      </main>
    </>
  );
}
