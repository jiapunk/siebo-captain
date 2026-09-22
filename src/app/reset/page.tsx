"use client";

import { useState } from "react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/client";
import { useI18n } from "@/lib/i18n";

export default function ResetPage() {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError(t("auth.verifyFail"));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.pwRule"));
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/reset", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (e) {
      const m = (e as Error).message;
      setError(m === "weak_password" ? t("auth.pwRule") : t("auth.verifyFail"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-16">
        <div className="cut mt-16 p-7">
          <div className="tag mb-2">RESET {"//"} ACCESS</div>
          <h1 className="font-display text-xl font-black">
            {t("auth.resetTitle")}
          </h1>

          {done ? (
            <div className="mt-6 text-center">
              <div className="text-sm text-phos">{t("auth.resetDone")}</div>
              <Link href="/login" className="btn btn-accent mt-6 px-6 py-2.5 text-sm">
                {t("auth.goLogin")}
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-6 space-y-3">
                <label className="block text-sm">
                  <span className="tag mb-1.5 block">NEW PASSWORD</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("login.phPwUp")}
                    className="w-full border border-line bg-base px-3.5 py-2.5 outline-none focus:border-phos"
                  />
                </label>
                <label className="block text-sm">
                  <span className="tag mb-1.5 block">CONFIRM</span>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    placeholder={t("login.phPwUp")}
                    className="w-full border border-line bg-base px-3.5 py-2.5 outline-none focus:border-phos"
                  />
                </label>
              </div>
              {error && (
                <div className="mt-4 border border-amber bg-amber-soft p-3 text-sm text-ink-soft">
                  {error}
                </div>
              )}
              <button
                onClick={submit}
                disabled={busy || !password}
                className="btn btn-accent mt-6 w-full py-3 disabled:opacity-50"
              >
                {busy ? "…" : t("auth.resetSubmit")}
              </button>
            </>
          )}
        </div>
      </main>
    </>
  );
}
