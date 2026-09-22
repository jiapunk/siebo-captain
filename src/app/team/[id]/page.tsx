"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { IconLock, IconUsers } from "@/components/Icons";
import { api, useMe } from "@/lib/client";
import { useI18n } from "@/lib/i18n";

interface Member {
  userId: string;
  name: string;
  emoji: string;
  isBot: boolean;
  role: string;
}

interface Msg {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export default function TeamChatPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const { me, loading } = useMe();
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingSentAt = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!loading && !me) {
      router.replace("/");
      return;
    }
    if (!me) return;

    const es = new EventSource(`/api/teams/${id}/stream`);
    es.onerror = () => {
      fetch(`/api/teams/${id}`)
        .then((r) => {
          if (r.status === 423) setLocked(true);
        })
        .catch(() => {});
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
          setMyId(msg.me ?? null);
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
        } else if (msg.type === "typing" && msg.userId && msg.userId !== myId) {
          setTypingUser(msg.userId);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTypingUser(null), 3000);
        }
      } catch {}
    };
    return () => es.close();
  }, [id, me, loading, router, scrollToBottom, myId]);

  async function send() {
    const content = input.trim();
    if (!content) return;
    setInput("");
    try {
      await api(`/api/teams/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      if ((err as Error).message === "locked") setLocked(true);
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

  const memberById = (uid: string) => members.find((m) => m.userId === uid);

  if (locked)
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <IconLock size={30} className="text-muted" />
          <div className="font-bold">{t("tc.locked")}</div>
          <p className="text-sm text-muted">
            {t("tc.lockedDesc")}
          </p>
          <Link href="/teams" className="btn btn-ink mt-2 px-6 py-2.5 text-sm">
            {t("tc.back")}
          </Link>
        </main>
      </>
    );

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
                {members.map((m) => (
                  <span key={m.userId} className="flex items-center gap-1">
                    <span className="text-base leading-none">{m.emoji}</span>
                    <span className="text-sm font-bold">
                      {m.name}
                      {m.userId === myId && (
                        <span className="mono ml-1 text-[9px] font-normal text-accent-deep">
                          (YOU)
                        </span>
                      )}
                    </span>
                  </span>
                ))}
              </div>
              <div className="mono mt-1 text-[10px] tracking-wider text-muted">
                {members.map((m) => `${m.name}//${m.role}`).join("  ")}
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
        >
          <div className="mono mb-5 flex items-center justify-center gap-2 text-[10px] tracking-wider text-muted">
            <IconLock size={12} />
            {t("tc.secure")}
          </div>
          {messages.map((m) => {
            const isMe = m.senderId === (myId ?? me?.id);
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
                        ? `${sender.name} // ${sender.role}`
                        : "UNKNOWN"}
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

        {/* 輸入 */}
        <div className="mt-3 flex gap-2">
          <div className="flex flex-1 items-center border border-line-strong bg-panel-2">
            <span className="mono pl-3 text-sm font-bold text-accent">{">"}</span>
            <input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.nativeEvent.isComposing && send()
              }
              placeholder={t("tc.placeholder")}
              className="min-w-0 flex-1 bg-transparent px-2.5 py-3 text-sm outline-none placeholder:text-muted/70"
            />
          </div>
          <button
            onClick={send}
            disabled={!input.trim()}
            className="btn btn-ink px-6 disabled:opacity-40"
          >
            {t("tc.send")}
          </button>
        </div>
      </main>
    </>
  );
}
