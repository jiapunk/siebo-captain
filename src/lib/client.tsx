"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { translate } from "./i18n-dict";

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

/**
 * API 錯誤：保留後端回應的錯誤碼與附帶欄位。
 * - message / code：後端的 `error`（例：rate_limited、already_running）；沒有 JSON body 時是 HTTP statusText
 * - body：完整的錯誤 JSON（例：runIds、max、field）
 * - retryAfterSec：body.retryAfterSec，或 Retry-After 標頭（秒）
 * - serverMessage：後端附帶的 `message`（若有）
 * message 仍等於錯誤碼，舊的 `(e as Error).message === "no_candidates"` 判斷照常可用。
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;
  readonly retryAfterSec: number | null;
  readonly serverMessage: string | null;
  constructor(
    status: number,
    code: string,
    body: Record<string, unknown>,
    retryAfterSec: number | null,
  ) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryAfterSec = retryAfterSec;
    this.serverMessage = typeof body.message === "string" ? body.message : null;
  }
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const raw: unknown = await res.json().catch(() => null);
    const body =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const code =
      typeof body.error === "string" && body.error
        ? body.error
        : res.statusText || `http_${res.status}`;
    const fromBody = Number(body.retryAfterSec);
    const fromHeader = Number(res.headers.get("Retry-After"));
    const retryAfterSec =
      Number.isFinite(fromBody) && fromBody > 0
        ? Math.ceil(fromBody)
        : Number.isFinite(fromHeader) && fromHeader > 0
          ? Math.ceil(fromHeader)
          : null;
    throw new ApiError(res.status, code, body, retryAfterSec);
  }
  return res.json() as Promise<T>;
}

/** 使用者自己取消（AbortController）的請求：頁面應該靜默忽略 */
export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException
    ? e.name === "AbortError"
    : (e as { name?: string } | null)?.name === "AbortError";
}

/** 錯誤碼（ApiError.code）；網路錯誤等非 API 錯誤回 null */
export function errorCode(e: unknown): string | null {
  return e instanceof ApiError ? e.code : null;
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** 常見 API 錯誤碼 → i18n key（字串放在 i18n-ext-a.ts 的 err.*，四語系） */
const ERROR_KEYS: Record<string, string> = {
  rate_limited: "err.rateLimited",
  too_many_attempts: "err.rateLimited",
  already_running: "err.alreadyRunning",
  in_progress: "err.inProgress",
  content_too_long: "err.contentTooLong",
  interview_too_long: "err.interviewTooLong",
  forbidden: "err.forbidden",
  too_many_streams: "err.tooManyStreams",
  email_unverified: "auth.gateBlocked",
  unauthorized: "err.unauthorized",
  payload_too_large: "err.payloadTooLarge",
  internal_error: "err.internal",
  invalid_json: "err.invalidRequest",
  conflict: "err.conflict",
  not_found: "err.notFound",
  locked: "err.locked",
  not_invitee: "err.notInvitee",
  below_threshold: "err.belowThreshold",
  cannot_compare: "err.cannotCompare",
};

/**
 * 把 api() 丟出的錯誤轉成使用者看得懂的四語系訊息。
 * - overrides：此頁專屬的錯誤碼 → i18n key（優先於通用對應）
 * - fallbackKey：未知錯誤碼時用的 key
 * 可用變數：{s}＝retryAfterSec、{max}＝body.max。網路錯誤（fetch 丟 TypeError）→ err.network。
 */
export function apiErrorText(
  e: unknown,
  t: TFn,
  fallbackKey: string,
  overrides?: Record<string, string>,
): string {
  if (!(e instanceof ApiError)) {
    return e instanceof TypeError ? t("err.network") : t(fallbackKey);
  }
  const key = overrides?.[e.code] ?? ERROR_KEYS[e.code];
  if (!key) return t(fallbackKey);
  if (key === "err.rateLimited" && e.retryAfterSec === null)
    return t("err.rateLimitedNoWait");
  const max = Number(e.body.max);
  return t(key, {
    s: e.retryAfterSec ?? 0,
    max: Number.isFinite(max) ? max : "—",
  });
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
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { me, loading, llmMode, authMode };
}

// ---------- 個人事件頻道（整個分頁共用一條 SSE） ----------

export interface BusEvent {
  type: string;
  [k: string]: unknown;
}
type BusListener = (evt: BusEvent) => void;

const busListeners = new Set<BusListener>();
let busSource: EventSource | null = null;
let busCloseTimer: ReturnType<typeof setTimeout> | null = null;

function openBus() {
  if (busCloseTimer) {
    clearTimeout(busCloseTimer);
    busCloseTimer = null;
  }
  if (busSource) return;
  const es = new EventSource("/api/bus/user");
  let firstReady = true;
  es.onmessage = (e) => {
    let evt: BusEvent;
    try {
      evt = JSON.parse(e.data) as BusEvent;
    } catch {
      return;
    }
    if (!evt || typeof evt.type !== "string") return;
    // 第一次連上的 ready 不轉發（頁面掛載時自己會載入）；斷線自動重連後的 ready 才轉發，讓頁面補抓
    if (evt.type === "ready" && firstReady) {
      firstReady = false;
      return;
    }
    for (const fn of Array.from(busListeners)) {
      try {
        fn(evt);
      } catch (err) {
        console.error("[bus] listener failed", err);
      }
    }
  };
  es.onerror = () => {
    // CLOSED＝伺服器拒絕（401／429 等），瀏覽器不會再重連；下一個訂閱者掛載時重開
    if (es.readyState === EventSource.CLOSED && busSource === es) busSource = null;
  };
  busSource = es;
}

/**
 * 訂閱個人事件頻道（非 hook 版）。第一個訂閱者開 SSE，最後一個退訂後關閉；
 * 關閉延後到下一個 tick，換頁或 StrictMode 重掛時會沿用同一條連線。
 */
export function subscribeUserBus(fn: BusListener): () => void {
  busListeners.add(fn);
  openBus();
  return () => {
    busListeners.delete(fn);
    if (busListeners.size > 0 || busCloseTimer) return;
    busCloseTimer = setTimeout(() => {
      busCloseTimer = null;
      if (busListeners.size === 0 && busSource) {
        busSource.close();
        busSource = null;
      }
    }, 0);
  };
}

export interface UserBusOptions {
  /** 只處理這些事件類型；省略時處理 part 以外的全部（part 是每個 Part 的高頻生命週期事件） */
  types?: string[];
  /** 防抖：最後一則事件後等多久才呼叫（預設 300ms；0 = 每則立即呼叫） */
  debounceMs?: number;
  /** 連續事件時最長等待（預設 1500ms），保證高頻事件期間仍會定期更新 */
  maxWaitMs?: number;
}

/**
 * 訂閱個人事件頻道，伺服器端狀態變更時觸發。
 * 整個分頁共用一條 /api/bus/user；預設防抖 300ms（最長 1.5s 必觸發一次），
 * onEvent 收到的是該批最後一則事件。
 */
export function useUserBus(
  onEvent: (evt: BusEvent) => void,
  opts?: UserBusOptions,
) {
  const handler = useEffectEvent((evt: BusEvent) => onEvent(evt));
  const types = opts?.types?.join(",") ?? "";
  const debounceMs = opts?.debounceMs ?? 300;
  const maxWaitMs = opts?.maxWaitMs ?? 1500;

  useEffect(() => {
    const allow = types ? new Set(types.split(",")) : null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let firstAt = 0;
    let latest: BusEvent | null = null;
    const fire = () => {
      timer = null;
      firstAt = 0;
      const evt = latest;
      latest = null;
      if (evt) handler(evt);
    };
    const off = subscribeUserBus((evt) => {
      if (allow ? !allow.has(evt.type) : evt.type === "part") return;
      if (debounceMs <= 0) {
        handler(evt);
        return;
      }
      latest = evt;
      const now = Date.now();
      if (!firstAt) firstAt = now;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, Math.min(debounceMs, Math.max(0, firstAt + maxWaitMs - now)));
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [types, debounceMs, maxWaitMs]);
}

/**
 * 相對時間（四語系）。請傳入 useI18n() 的 t；省略時用繁中（與 LocaleProvider 的初始語系一致，不會造成 hydration 不一致）。
 */
export function timeAgo(iso: string | Date, t?: TFn): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  const tr: TFn = t ?? ((key, vars) => translate("zh", key, vars));
  if (s < 60) return tr("time.justNow");
  if (s < 3600) return tr("time.minutes", { n: Math.floor(s / 60) });
  if (s < 86400) return tr("time.hours", { n: Math.floor(s / 3600) });
  return tr("time.days", { n: Math.floor(s / 86400) });
}
