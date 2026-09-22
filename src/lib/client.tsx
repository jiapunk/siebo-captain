"use client";

import { useEffect, useState } from "react";

export interface Me {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  isBot: boolean;
  email?: string | null;
  emailVerified?: boolean | null;
  event?: { id: string; name: string; code: string } | null;
  profileStatus: "draft" | "ready";
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(body.error ?? res.statusText) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [llmMode, setLlmMode] = useState<"mock" | "real" | "hybrid" | null>(null);
  const [authMode, setAuthMode] = useState<"session" | "demo" | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<{
      user: Me | null;
      llmMode?: "mock" | "real" | "hybrid";
      authMode?: "session" | "demo" | null;
    }>("/api/me")
      .then((d) => {
        setMe(d.user);
        if (d.llmMode) setLlmMode(d.llmMode);
        setAuthMode(d.authMode ?? null);
      })
      .finally(() => setLoading(false));
  }, []);
  return { me, loading, llmMode, authMode };
}

/** 訂閱個人事件頻道，伺服器端狀態變更時觸發 */
export function useUserBus(onEvent: (evt: { type: string }) => void) {
  useEffect(() => {
    const es = new EventSource("/api/bus/user");
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {}
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function timeAgo(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "剛剛";
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  return `${Math.floor(s / 86400)} 天前`;
}
