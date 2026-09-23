"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/client";
import { apiErrorMessage, useI18n } from "@/lib/i18n";

const ERROR_KEYS: Record<string, string> = {
  invalid_credentials: "login.errInvalid",
  email_taken: "login.errTaken",
  invalid_email: "login.errEmail",
  weak_password: "auth.pwRule",
  name_required: "login.errName",
  invalid_event_code: "login.errCode",
  email_unverified: "login.errUnverified",
};

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [eventCode, setEventCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  // 忘記密碼送出後一律顯示中性回覆（不透露帳號是否存在）；只有 dev 模式才會附重設連結
  const [forgotDone, setForgotDone] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === "forgot") {
        const res = await api<{ devResetUrl?: string | null }>(
          "/api/auth/forgot",
          { method: "POST", body: JSON.stringify({ email }) },
        );
        setResetUrl(res.devResetUrl ?? null);
        setForgotDone(true);
        return;
      }
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      await api(path, {
        method: "POST",
        body: JSON.stringify(
          mode === "login"
            ? { email, password }
            : {
                email,
                password,
                name,
                emoji: "🚀",
                eventCode: eventCode.trim() || undefined,
              },
        ),
      });
      router.push(mode === "register" ? "/onboarding" : "/agent");
      router.refresh();
    } catch (e) {
      const msg = (e as Error).message;
      // too_many_attempts 交給 apiErrorMessage（有 retryAfterSec 時會顯示秒數）
      setError(ERROR_KEYS[msg] ? t(ERROR_KEYS[msg]) : apiErrorMessage(t, e, "login.errGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-16">
        <div className="card cut mt-16">
          <div className="ticks-x" />
          <div className="p-7">
            <div className="tag flex items-center gap-2">
              <span className="led led-live" />
              ACCESS {"// "}
              {mode === "login"
                ? t("login.submitIn")
                : mode === "register"
                  ? t("login.titleUp")
                  : t("auth.forgot")}
            </div>
            <h1 className="font-display mt-2 text-xl font-black">
              {mode === "login"
                ? t("login.titleIn")
                : mode === "register"
                  ? t("login.titleUp")
                  : t("auth.forgot")}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {mode === "login"
                ? t("login.descIn")
                : mode === "register"
                  ? t("login.descUp")
                  : t("auth.forgotDesc")}
            </p>

            <div className="mt-6 space-y-3.5">
              {mode === "register" && (
                <Field
                  label="NAME"
                  value={name}
                  onChange={setName}
                  placeholder={t("login.phName")}
                  maxLength={12}
                  autoComplete="nickname"
                />
              )}
              <Field
                label="EMAIL"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                onSubmit={submit}
              />
              {mode !== "forgot" && (
              <Field
                label="PASSWORD"
                value={password}
                onChange={setPassword}
                placeholder={
                  mode === "register" ? t("login.phPwUp") : t("login.phPwIn")
                }
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                onSubmit={submit}
              />
              )}
              {mode === "register" && (
                <Field
                  label="EVENT CODE"
                  value={eventCode}
                  onChange={setEventCode}
                  placeholder={t("login.phCode")}
                  onSubmit={submit}
                />
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 border border-amber bg-amber-soft p-3 text-sm text-ink-soft"
              >
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={
                busy ||
                !email ||
                (mode === "login" && !password) ||
                (mode === "register" && (!password || !name))
              }
              className="btn btn-accent mt-6 w-full py-3 disabled:opacity-50"
            >
              {busy
                ? "…"
                : mode === "login"
                  ? t("login.submitIn")
                  : mode === "register"
                    ? t("login.submitUp")
                    : t("auth.forgotSubmit")}
            </button>

            {mode === "login" && (
              <button
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setResetUrl(null);
                  setForgotDone(false);
                }}
                className="mono mt-3 w-full text-center text-[11px] tracking-wider text-muted hover:text-alert"
              >
                {t("auth.forgot")}
              </button>
            )}

            {mode === "forgot" && forgotDone && (
              <div
                role="status"
                className="mt-4 border border-sage bg-sage-soft p-3 text-sm text-ink-soft"
              >
                <div>{t(resetUrl ? "auth.forgotSent" : "b.auth.forgotAck")}</div>
                {resetUrl && (
                  <a
                    href={resetUrl}
                    className="mono mt-2 inline-block border border-phos px-3 py-1.5 text-[11px] tracking-wider text-phos hover:bg-phos/10"
                  >
                    {t("auth.resetLink")}
                  </a>
                )}
              </div>
            )}

            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError(null);
                setResetUrl(null);
                setForgotDone(false);
              }}
              className="mono mt-4 w-full text-center text-[11px] tracking-wider text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {mode === "login"
                ? `${t("login.toUp")} // SIGN UP`
                : mode === "register"
                  ? `${t("login.toIn")} // SIGN IN`
                  : `${t("login.toIn")} // SIGN IN`}
            </button>
          </div>
        </div>

        <p className="mono mt-6 text-center text-[11px] tracking-wider text-muted">
          {t("login.guest1")}{" "}
          <Link href="/" className="text-accent underline underline-offset-2">
            {t("login.guestLink")}
          </Link>
        </p>
      </main>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
  autoComplete,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  maxLength?: number;
  autoComplete?: string;
  onSubmit?: () => void;
}) {
  return (
    <label className="block text-sm">
      <span className="tag mb-1.5 block">{label}</span>
      <div className="flex items-center border border-line-strong bg-base focus-within:bg-panel-2">
        <span className="mono pl-3 text-xs font-bold text-accent">▸</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && onSubmit)
              onSubmit();
          }}
          placeholder={placeholder}
          type={type}
          maxLength={maxLength}
          autoComplete={autoComplete}
          className="w-full bg-transparent px-2.5 py-2.5 outline-none"
        />
      </div>
    </label>
  );
}
