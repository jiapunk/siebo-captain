"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { IconLock } from "@/components/Icons";
import { api, useMe, useUserBus } from "@/lib/client";
import { apiErrorMessage, useI18n } from "@/lib/i18n";

interface Msg {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
}

/** GET /api/connections/[id]（非串流）：requested 時 direction 表示我是發起者或被邀請者 */
interface ConnState {
  id: string;
  status: "requested" | "connected" | string;
  direction: "outgoing" | "incoming" | null;
  other: { id: string; name: string; emoji: string; isBot?: boolean };
}

const smooth = (): ScrollBehavior =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

export default function ConnectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { me, loading } = useMe();
  const { t } = useI18n();
  const [conn, setConn] = useState<ConnState | null>(null);
  const [missing, setMissing] = useState(false);
  const [other, setOther] = useState<{ id: string; name: string; emoji: string } | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  // 存原始錯誤，顯示時才翻譯：loadState 不必依賴 t（切語系不會讓 SSE 重連）
  const [error, setError] = useState<unknown>(null);
  const [accepting, setAccepting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 串流 init 帶回的「我」；放 ref，避免它變動時讓 SSE effect 關掉重開
  const myIdRef = useRef<string | null>(null);
  const typingSentAt = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connected = conn?.status === "connected";

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: smooth() });
  }, []);

  /** 用非串流的狀態 endpoint 判斷能不能聊（不要去 fetch 串流本身） */
  const loadState = useCallback(() => {
    api<ConnState>(`/api/connections/${id}`)
      .then((c) => {
        setConn(c);
        setMissing(false);
      })
      .catch((e: Error & { status?: number }) => {
        if (e.status === 404) setMissing(true);
        else if (e.status === 401) router.replace("/");
        else setError(e);
      });
  }, [id, router]);

  useEffect(() => {
    if (!loading && !me) {
      router.replace("/");
      return;
    }
    if (me) loadState();
  }, [me, loading, router, loadState]);

  // 還在等對方接受時，對方一接受就會收到 user refresh → 重新查狀態（只看 refresh，忽略 part 等高頻事件）
  useUserBus((evt) => {
    if (evt.type === "refresh" || evt.type === "ready") loadState();
  });

  // 只有 connected 才開 SSE；依賴只有 id 與 connected，init 後不會重連
  useEffect(() => {
    if (!connected) return;
    const es = new EventSource(`/api/connections/${id}/stream`);
    es.onerror = () => {
      // 伺服器回非 200（423 / 404）時瀏覽器不會自動重連：改查一次狀態
      if (es.readyState === EventSource.CLOSED) loadState();
    };
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string;
          me?: string;
          other?: { id: string; name: string; emoji: string };
          messages?: Msg[];
          message?: Msg;
          userId?: string;
        };
        if (msg.type === "init") {
          myIdRef.current = msg.me ?? null;
          setOther(msg.other ?? null);
          setMessages(msg.messages ?? []);
          setTimeout(scrollToBottom, 100);
        } else if (msg.type === "message" && msg.message) {
          setMessages((prev) =>
            prev.some((m) => m.id === msg.message!.id) ? prev : [...prev, msg.message!],
          );
          setTyping(false);
          setTimeout(scrollToBottom, 50);
        } else if (
          msg.type === "typing" &&
          msg.userId &&
          msg.userId !== myIdRef.current
        ) {
          setTyping(true);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(false), 3000);
        }
      } catch {}
    };
    return () => es.close();
  }, [id, connected, scrollToBottom, loadState]);

  async function accept() {
    if (accepting) return;
    setAccepting(true);
    setError(null);
    try {
      await api(`/api/connections/${id}/accept`, { method: "POST" });
      loadState();
    } catch (e) {
      setError(e);
    } finally {
      setAccepting(false);
    }
  }

  async function send() {
    const content = input.trim();
    if (!content) return;
    setInput("");
    setError(null);
    try {
      await api(`/api/connections/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      setInput(content);
      if ((err as Error).message === "locked") loadState();
      else setError(err);
    }
  }

  function onInputChange(v: string) {
    setInput(v);
    const now = Date.now();
    if (now - typingSentAt.current > 1800) {
      typingSentAt.current = now;
      fetch(`/api/connections/${id}/typing`, { method: "POST" }).catch(() => {});
    }
  }

  // 還不能聊：找不到、等對方接受、或等我接受
  if (missing || (conn && !connected)) {
    const incoming = conn?.direction === "incoming";
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <IconLock size={30} className="text-muted" />
          <div className="font-bold">
            {missing
              ? t("b.conn.missing")
              : incoming
                ? t("b.conn.incomingTitle", { name: conn?.other.name ?? "" })
                : t("conn.locked")}
          </div>
          <p className="max-w-sm text-sm text-muted">
            {missing
              ? t("b.conn.missingDesc")
              : incoming
                ? t("b.conn.incomingDesc")
                : t("b.conn.pendingOutgoing", { name: conn?.other.name ?? "" })}
          </p>
          {error != null && (
            <p role="alert" className="text-xs text-amber">
              {apiErrorMessage(t, error)}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {incoming && (
              <button
                onClick={accept}
                disabled={accepting}
                className="btn btn-accent px-6 py-2.5 text-sm disabled:opacity-50"
              >
                {accepting ? "…" : t("b.conn.accept")}
              </button>
            )}
            <Link href="/teams" className="btn btn-ink px-6 py-2.5 text-sm">
              {t("conn.back")}
            </Link>
          </div>
        </main>
      </>
    );
  }

  const shownOther = other ?? conn?.other ?? null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-4">
        <div className="cut mt-6 mb-3">
          <div className="flex items-center gap-3 p-3.5">
            <span className="reticle flex h-11 w-11 items-center justify-center border border-line bg-base text-xl">
              {shownOther?.emoji ?? "…"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-bold">{shownOther?.name ?? "…"}</div>
              <div className="mono mt-0.5 text-[10px] tracking-wider text-muted">
                {typing ? t("tc.typing", { name: shownOther?.name ?? "" }) : t("conn.title")}
              </div>
            </div>
            <Link href="/teams" className="btn btn-outline px-3 py-1.5 text-xs">
              {t("conn.back")}
            </Link>
          </div>
        </div>

        <div
          className="cut flex-1 overflow-y-auto p-4"
          style={{ minHeight: "55vh" }}
          aria-live="polite"
        >
          <div className="mono mb-5 flex items-center justify-center gap-2 text-center text-[10px] tracking-wider text-muted">
            <IconLock size={12} className="shrink-0" />
            {t("conn.direct")}
          </div>
          {messages.map((m) => {
            const isMe = m.senderId === me?.id;
            return (
              <div
                key={m.id}
                data-msg
                className={`rise-in mb-3.5 flex ${isMe ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[80%] ${isMe ? "text-right" : ""}`}>
                  <div className="mono mb-1 text-[9px] tracking-[0.14em] text-muted">
                    {isMe ? t("tc.you") : shownOther?.name ?? ""}
                  </div>
                  <div
                    className={`inline-block border px-4 py-2.5 text-left text-sm leading-relaxed ${
                      isMe
                        ? "border-phos bg-phos text-[#04211a]"
                        : "border-line bg-panel-2 text-ink-soft"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              </div>
            );
          })}
          {typing && (
            <div className="mb-3.5 flex flex-col items-start">
              <div className="mono mb-1 text-[9px] tracking-[0.14em] text-muted">
                {shownOther?.name} {"//"} …
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

        {error != null && (
          <p role="alert" className="mt-2 text-xs text-amber">
            {apiErrorMessage(t, error)}
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <div className="flex flex-1 items-center border border-line-strong bg-base">
            <span aria-hidden="true" className="mono pl-3 text-sm font-bold text-alert">
              {">"}
            </span>
            <input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.nativeEvent.isComposing && send()
              }
              placeholder={t("conn.placeholder")}
              aria-label={t("conn.placeholder")}
              maxLength={2000}
              disabled={!connected}
              className="min-w-0 flex-1 bg-transparent px-2.5 py-3 text-sm outline-none placeholder:text-muted/70"
            />
          </div>
          <button
            onClick={send}
            disabled={!input.trim() || !connected}
            className="btn btn-ink disabled:opacity-40"
          >
            {t("tc.send")}
          </button>
        </div>
      </main>
    </>
  );
}
