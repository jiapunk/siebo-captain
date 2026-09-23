"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { LOCALE_COOKIE, translate, type Locale } from "./i18n-dict";

type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFn;
}

const Ctx = createContext<I18nValue>({
  locale: "zh",
  setLocale: () => {},
  t: (k) => k,
});

const COOKIE_RE = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=(zh|cn|en|ja)(?:;|$)`);

function writeLocaleCookie(l: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/**
 * initialLocale 由 root layout 在伺服器端決定（sc_lang cookie → Accept-Language → zh），
 * SSR 與 hydration 用同一個值，不會先閃繁中、也不會有前後端不一致。
 */
export function LocaleProvider({
  children,
  initialLocale = "zh",
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // 首次造訪（還沒有 sc_lang）：把伺服器偵測到的語系寫回 cookie，
  // 之後 API 產生的動態內容（訪談、逐字稿、破冰卡、隊伍訊息）都用同一個語系
  useEffect(() => {
    if (!COOKIE_RE.test(document.cookie)) writeLocaleCookie(initialLocale);
  }, [initialLocale]);

  useEffect(() => {
    document.documentElement.lang =
      locale === "zh"
        ? "zh-Hant"
        : locale === "cn"
          ? "zh-Hans"
          : locale === "ja"
            ? "ja"
            : "en";
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    writeLocaleCookie(l);
  }, []);

  const t = useCallback<TFn>(
    (key, vars) => translate(locale, key, vars),
    [locale],
  );

  return <Ctx.Provider value={{ locale, setLocale, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

export function useT() {
  return useContext(Ctx).t;
}

/** api() 丟出的錯誤：message 是 API 的 error 碼；若 client 有附上回應 body，就讀 retryAfterSec / max */
type ApiErrLike = {
  message?: unknown;
  retryAfterSec?: unknown;
  body?: { retryAfterSec?: unknown; max?: unknown } | null;
};

/**
 * API 錯誤碼 → 目前語系的使用者訊息（key 在 i18n-ext-b.ts 的 b.err.*）。
 * 認不得的碼回 fallbackKey；fetch 本身失敗（離線、伺服器重啟）回 b.err.network。
 */
export function apiErrorMessage(t: TFn, e: unknown, fallbackKey = "b.err.generic"): string {
  const err = (e ?? {}) as ApiErrLike;
  const code = typeof err.message === "string" ? err.message : "";
  const sec = Number(err.retryAfterSec ?? err.body?.retryAfterSec);
  const max = Number(err.body?.max);
  switch (code) {
    case "rate_limited":
    case "too_many_attempts":
      return Number.isFinite(sec) && sec > 0
        ? t("b.err.rateLimitedSec", { sec: Math.ceil(sec) })
        : t("b.err.rateLimited");
    case "email_unverified":
      return t("auth.gateBlocked");
    case "unauthorized":
      return t("b.err.unauthorized");
    case "in_progress":
      return t("b.err.inProgress");
    case "already_running":
      return t("b.err.alreadyRunning");
    case "content_too_long":
      return t("b.err.contentTooLong", { max: Number.isFinite(max) ? max : 1000 });
    case "interview_too_long":
      return t("b.err.interviewTooLong");
    case "forbidden":
      return t("b.err.forbidden");
    case "locked":
      return t("b.err.locked");
    case "not found":
    case "not_found":
      return t("b.err.notFound");
    case "payload_too_large":
      return t("b.err.payloadTooLarge");
    case "too_many_streams":
      return t("b.err.tooManyStreams");
    case "bad_origin":
      return t("b.err.badOrigin");
    case "not_invitee":
      return t("b.err.notInvitee");
  }
  if (e instanceof TypeError) return t("b.err.network");
  return t(fallbackKey);
}
