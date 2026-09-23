"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { IconArrowRight, IconShield } from "@/components/Icons";
import { api, useMe } from "@/lib/client";
import { apiErrorMessage, useI18n } from "@/lib/i18n";
import { CONTENT } from "@/lib/content";

interface Turn {
  role: "agent" | "user";
  content: string;
  ts: number;
}

/** 與 /api/onboarding/message 的單則上限一致 */
const MAX_ANSWER = 1000;

const smooth = (): ScrollBehavior =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

export default function OnboardingPage() {
  const router = useRouter();
  const { me, llmMode } = useMe();
  const { t: tr, locale } = useI18n();
  // 伺服器端存的訪談（第一題不入庫：由前端依目前語系顯示）
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [done, setDone] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 隱私告知：新訪談要先勾選同意才開始（已經有回答的訪談代表先前已同意）
  const [agreed, setAgreed] = useState(false);
  const [started, setStarted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // interview：{ consentAt, sid, turns }；舊資料是純 Turn[]
    api<{ profile: { status: string; interview: Turn[] | { turns?: Turn[] } | null } }>(
      "/api/profile",
    )
      .then(({ profile }) => {
        if (profile.status === "ready") {
          router.replace("/profile");
          return;
        }
        const iv = profile.interview;
        const history = (Array.isArray(iv) ? iv : iv?.turns) ?? [];
        setTurns(history);
        setDone(history.filter((t) => t.role === "user").length >= 6);
      })
      .catch(() => router.replace("/"));
  }, [router]);

  // 第一題不入庫：依「目前」語系補在最前面（切換語系不必重抓 /api/profile）
  const shown: Turn[] =
    turns === null
      ? []
      : turns.length === 0 || turns[0].role === "user"
        ? [{ role: "agent", content: CONTENT[locale].interview[0], ts: 0 }, ...turns]
        : turns;
  const needsConsent = turns !== null && turns.length === 0 && !started;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: smooth() });
  }, [turns, thinking]);

  async function send() {
    const content = input.trim();
    if (!content || thinking || done || !turns) return;
    if (content.length > MAX_ANSWER) {
      setError(tr("b.err.contentTooLong", { max: MAX_ANSWER }));
      return;
    }
    setError(null);
    setInput("");
    // 樂觀顯示；失敗時回滾並把文字放回輸入框（伺服器只有在 LLM 成功後才寫入）
    setTurns([...turns, { role: "user", content, ts: Date.now() }]);
    setThinking(true);
    try {
      // 第一則回答附上隱私告知的同意（伺服器在第一輪要求 consent: true，並記下同意時間）
      const payload = turns.length === 0 ? { content, consent: agreed } : { content };
      const res = await api<{ reply: string; done: boolean }>(
        "/api/onboarding/message",
        { method: "POST", body: JSON.stringify(payload) },
      );
      setTurns((t) => [
        ...(t ?? []),
        { role: "agent", content: res.reply, ts: Date.now() },
      ]);
      if (res.done) setDone(true);
    } catch (e) {
      const code = (e as Error).message;
      if (code === "already_compiled") {
        router.replace("/profile");
        return;
      }
      setTurns(turns);
      setInput(content);
      if (code === "unauthorized") {
        router.replace("/");
        return;
      }
      if (code === "consent_required") {
        // 伺服器端的訪談還是空的、但沒有同意紀錄：回到告知卡重新勾選
        setAgreed(false);
        setStarted(false);
        setError(tr("b.onb.consentRequired"));
        return;
      }
      setError(apiErrorMessage(tr, e));
    } finally {
      setThinking(false);
    }
  }

  async function compile() {
    setCompiling(true);
    setError(null);
    try {
      await api("/api/onboarding/compile", { method: "POST" });
      router.push("/profile?compiled=1");
    } catch (e) {
      if ((e as Error).message === "already_compiled") {
        router.replace("/profile");
        return;
      }
      setError(apiErrorMessage(tr, e));
      setCompiling(false);
    }
  }

  const progress = Math.min(6, shown.filter((t) => t.role === "user").length);

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
              <div
                className="flex flex-1 gap-[3px]"
                role="progressbar"
                aria-label={tr("onb.tag")}
                aria-valuemin={0}
                aria-valuemax={6}
                aria-valuenow={progress}
              >
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

        {needsConsent ? (
          /* 隱私告知＋同意：開始訪談前 */
          <section
            aria-labelledby="onb-privacy-title"
            className="card cut rise-in p-5"
          >
            <div className="flex items-center gap-2">
              <IconShield size={16} className="text-phos" />
              <h2 id="onb-privacy-title" className="font-bold">
                {tr("b.onb.privacyTitle")}
              </h2>
            </div>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
              <li>{tr("b.onb.privacyAi")}</li>
              <li>{tr("b.onb.privacyScope")}</li>
              <li>{tr("b.onb.privacyDelete")}</li>
              <li>{tr("b.onb.privacyRetention")}</li>
            </ul>
            {llmMode === "mock" && (
              <p className="mono mt-3 text-[11px] leading-relaxed text-muted">
                {tr("b.onb.privacyMock")}
              </p>
            )}
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--phos)]"
              />
              <span>{tr("b.onb.agree")}</span>
            </label>
            {error && (
              <div
                role="alert"
                className="mt-3 border border-amber bg-amber-soft p-2.5 text-xs text-ink-soft"
              >
                {error}
              </div>
            )}
            <button
              onClick={() => {
                setError(null);
                setStarted(true);
              }}
              disabled={!agreed}
              className="btn btn-accent mt-4 w-full py-3 disabled:opacity-50"
            >
              {tr("b.onb.start")}
              <IconArrowRight size={17} />
            </button>
          </section>
        ) : (
          <>
            {/* 對話 */}
            <div
              className="card cut flex-1 overflow-y-auto p-5"
              style={{ minHeight: "50vh" }}
              aria-live="polite"
            >
              {shown.map((t, i) => (
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

            {error && (
              <div
                role="alert"
                className="mt-3 border border-amber bg-amber-soft p-2.5 text-xs text-ink-soft"
              >
                {error}
              </div>
            )}

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
                  <span aria-hidden="true" className="mono pl-3 text-sm font-bold text-accent">
                    {">"}
                  </span>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && !e.nativeEvent.isComposing && send()
                    }
                    placeholder={tr("onb.placeholder")}
                    aria-label={tr("onb.placeholder")}
                    maxLength={MAX_ANSWER}
                    disabled={thinking || turns === null}
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
          </>
        )}
      </main>
    </>
  );
}
