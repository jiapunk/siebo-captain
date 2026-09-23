"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { IconLock, IconUsers } from "@/components/Icons";
import { api, useMe, useUserBus } from "@/lib/client";
import { apiErrorMessage, useI18n } from "@/lib/i18n";
import { roleDisplay } from "@/lib/content";

interface Member {
  userId: string;
  name: string;
  emoji: string;
  isBot: boolean;
  role: string;
  accepted?: boolean;
  isMe?: boolean;
}

interface Msg {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
}

/** GET /api/teams/[id]（非串流）：proposed 時 pending 是還沒同意的真人 userId */
interface TeamState {
  id: string;
  status: "proposed" | "assembled" | string;
  members: Member[];
  pending: string[];
}

const smooth = (): ScrollBehavior =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

export default function TeamChatPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const router = useRouter();
  const { me, loading } = useMe();
  const [team, setTeam] = useState<TeamState | null>(null);
  const [missing, setMissing] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  // 存原始錯誤，顯示時才翻譯（loadState 不依賴 t，切語系不會讓 SSE 重連）
  const [error, setError] = useState<unknown>(null);
  const [joining, setJoining] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 串流 init 帶回的「我」；放 ref，不當 SSE effect 的依賴（避免 init 後關掉重開）
  const myIdRef = useRef<string | null>(null);
  const typingSentAt = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assembled = team?.status === "assembled";

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: smooth() });
  }, []);

  /** 用非串流的隊伍 endpoint 判斷聊天室開了沒（proposed 回 200，不能只看 423） */
  const loadState = useCallback(() => {
    api<TeamState>(`/api/teams/${id}`)
      .then((d) => {
        setTeam(d);
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

  // 等隊友同意時：有人同意／隊伍成立都會發 user refresh（忽略 part 等高頻事件）
  useUserBus((evt) => {
    if (evt.type === "refresh" || evt.type === "ready") loadState();
  });

  // 只有 assembled 才開 SSE；依賴只有 id 與 assembled
  useEffect(() => {
    if (!assembled) return;
    const es = new EventSource(`/api/teams/${id}/stream`);
    es.onerror = () => {
      // 非 200（423 / 404）時瀏覽器不會自動重連：改查一次狀態
      if (es.readyState === EventSource.CLOSED) loadState();
    };
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as {
          type: string;
          me?: string;
          members?: Member[];
          messages?: Msg[];
          message?: Msg;
          userId?: string;
        };
        if (msg.type === "init") {
          myIdRef.current = msg.me ?? null;
          setMembers(msg.members ?? []);
          setMessages(msg.messages ?? []);
          setTimeout(scrollToBottom, 100);
        } else if (msg.type === "message" && msg.message) {
          setMessages((prev) =>
            prev.some((m) => m.id === msg.message!.id)
              ? prev
              : [...prev, msg.message!],
          );
          setTypingUser(null);
          setTimeout(scrollToBottom, 50);
        } else if (
          msg.type === "typing" &&
          msg.userId &&
          msg.userId !== myIdRef.current
        ) {
          setTypingUser(msg.userId);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTypingUser(null), 3000);
        }
      } catch {}
    };
    return () => es.close();
  }, [id, assembled, scrollToBottom, loadState]);

  async function join() {
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      await api(`/api/teams/${id}`, { method: "POST" });
      loadState();
    } catch (e) {
      setError(e);
    } finally {
      setJoining(false);
    }
  }

  async function send() {
    const content = input.trim();
    if (!content) return;
    setInput("");
    setError(null);
    try {
      await api(`/api/teams/${id}/messages`, {
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
      fetch(`/api/teams/${id}/typing`, { method: "POST" }).catch(() => {});
    }
  }

  const roster = members.length ? members : (team?.members ?? []);
  const memberById = (uid: string) => roster.find((m) => m.userId === uid);

  // 聊天室還沒開：找不到隊伍，或還在等成員同意
  if (missing || (team && !assembled)) {
    const mine = team?.members.find((m) => m.isMe);
    const waiting = (team?.members ?? []).filter((m) =>
      team?.pending.includes(m.userId),
    );
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <IconLock size={30} className="text-muted" />
          <div className="font-bold">
            {missing ? t("b.team.missing") : t("tc.locked")}
          </div>
          <p className="max-w-sm text-sm text-muted">
            {missing
              ? t("b.team.missingDesc")
              : mine?.accepted
                ? t("b.team.waitingFor", {
                    names: waiting.map((m) => m.name).join(t("b.listSep")) || "—",
                  })
                : t("tc.lockedDesc")}
          </p>
          {team && !missing && (
            <ul className="mt-1 w-full max-w-xs space-y-1.5 text-left text-sm">
              {team.members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center gap-2 border border-line bg-panel-2 px-3 py-2"
                >
                  <span aria-hidden="true">{m.emoji}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {m.name}
                    {m.isMe && (
                      <span className="mono ml-1 text-[9px] text-alert">YOU</span>
                    )}
                  </span>
                  <span
                    className={`mono text-[10px] tracking-wider ${
                      m.accepted ? "text-phos" : "text-amber"
                    }`}
                  >
                    {m.isBot
                      ? t("b.team.botAccepted")
                      : m.accepted
                        ? t("b.team.accepted")
                        : t("b.team.pending")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {error != null && (
            <p role="alert" className="text-xs text-amber">
              {apiErrorMessage(t, error)}
            </p>
          )}
          <div className="mt-2 flex gap-2">
            {mine && !mine.accepted && (
              <button
                onClick={join}
                disabled={joining}
                className="btn btn-accent px-6 py-2.5 text-sm disabled:opacity-50"
              >
                {joining ? t("teams.joining") : t("teams.join")}
              </button>
            )}
            <Link href="/teams" className="btn btn-ink px-6 py-2.5 text-sm">
              {t("tc.back")}
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-4">
        {/* 隊伍標頭 */}
        <div className="card cut mt-6 mb-3">
          <div className="flex items-center gap-3 p-3.5">
            <span className="flex h-10 w-10 items-center justify-center border border-line-strong bg-base text-ink-soft">
              <IconUsers size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {roster.map((m) => (
                  <span key={m.userId} className="flex items-center gap-1">
                    <span className="text-base leading-none">{m.emoji}</span>
                    <span className="text-sm font-bold">
                      {m.name}
                      {m.userId === me?.id && (
                        <span className="mono ml-1 text-[9px] font-normal text-accent-deep">
                          (YOU)
                        </span>
                      )}
                    </span>
                  </span>
                ))}
              </div>
              <div className="mono mt-1 text-[10px] tracking-wider text-muted">
                {roster.map((m) => `${m.name}//${roleDisplay(locale, m.role)}`).join("  ")}
              </div>
            </div>
            <Link href="/teams" className="btn btn-outline px-3 py-1.5 text-xs">
              {t("tc.info")}
            </Link>
          </div>
        </div>

        {/* 訊息 */}
        <div
          className="card cut flex-1 overflow-y-auto p-4"
          style={{ minHeight: "55vh" }}
          aria-live="polite"
        >
          <div className="mono mb-5 flex items-center justify-center gap-2 text-center text-[10px] tracking-wider text-muted">
            <IconLock size={12} className="shrink-0" />
            {t("tc.secure")}
          </div>
          {messages.map((m) => {
            const isMe = m.senderId === me?.id;
            const sender = memberById(m.senderId);
            return (
              <div
                key={m.id}
                data-msg
                className={`rise-in mb-3.5 flex ${isMe ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[80%] ${isMe ? "text-right" : ""}`}>
                  <div className="mono mb-1 text-[9px] tracking-[0.14em] text-muted">
                    {isMe
                      ? t("tc.you")
                      : sender
                        ? `${sender.name} // ${roleDisplay(locale, sender.role)}`
                        : t("b.team.unknownSender")}
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
          {typingUser && memberById(typingUser) && (
            <div className="mb-3.5 flex flex-col items-start">
              <div className="mono mb-1 text-[9px] tracking-[0.14em] text-muted">
                {t("tc.typing", { name: memberById(typingUser)!.name })}
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

        {/* 輸入 */}
        <div className="mt-3 flex gap-2">
          <div className="flex flex-1 items-center border border-line-strong bg-panel-2">
            <span aria-hidden="true" className="mono pl-3 text-sm font-bold text-accent">
              {">"}
            </span>
            <input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.nativeEvent.isComposing && send()
              }
              placeholder={t("tc.placeholder")}
              aria-label={t("tc.placeholder")}
              maxLength={2000}
              disabled={!assembled}
              className="min-w-0 flex-1 bg-transparent px-2.5 py-3 text-sm outline-none placeholder:text-muted/70"
            />
          </div>
          <button
            onClick={send}
            disabled={!input.trim() || !assembled}
            className="btn btn-ink px-6 disabled:opacity-40"
          >
            {t("tc.send")}
          </button>
        </div>
      </main>
    </>
  );
}
