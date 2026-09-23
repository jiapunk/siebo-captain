"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/client";
import { useI18n } from "@/lib/i18n";
import { IconCheck, IconLock } from "@/components/Icons";

/**
 * 同一個 token 只送一次（token 是一次性的；StrictMode 下 effect 會跑兩次，第二次會拿到 invalid_token）。
 * 只有網路／5xx 錯誤才重試一次；400 invalid_token 重試也不會成功。
 */
const inflight = new Map<string, Promise<unknown>>();
function verifyOnce(token: string): Promise<unknown> {
  let p = inflight.get(token);
  if (!p) {
    const attempt = () =>
      api("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
    p = attempt().catch((e: Error & { status?: number }) =>
      e.status && e.status < 500
        ? Promise.reject(e)
        : new Promise((r) => setTimeout(r, 1500)).then(attempt),
    );
    inflight.set(token, p);
  }
  return p;
}

export default function VerifyPage() {
  // useSearchParams 需要 Suspense 邊界（靜態預渲染時會退回 client 端）
  return (
    <Suspense fallback={<AppHeader />}>
      <VerifyInner />
    </Suspense>
  );
}

function VerifyInner() {
  const { t } = useI18n();
  const token = useSearchParams().get("token");
  const [result, setResult] = useState<"ok" | "fail" | null>(null);
  // 沒有 token 直接是失敗，不必在 effect 裡同步 setState
  const state: "working" | "ok" | "fail" = !token ? "fail" : (result ?? "working");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    verifyOnce(token)
      .then(() => !cancelled && setResult("ok"))
      .catch(() => !cancelled && setResult("fail"));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-md flex-1 px-4 pb-16">
        <div className="cut mt-16 p-7 text-center">
          {state === "working" && (
            <>
              <span className="led led-live mx-auto mb-4 block" />
              <div className="font-bold">{t("auth.verifying")}</div>
            </>
          )}
          {state === "ok" && (
            <>
              <IconCheck size={34} className="mx-auto mb-3 text-phos" />
              <div className="font-display text-xl font-black text-phos">
                {t("auth.verifyOk")}
              </div>
              <p className="mt-2 text-sm text-muted">{t("auth.verifyOkDesc")}</p>
              <Link href="/agent" className="btn btn-accent mt-6 px-6 py-2.5 text-sm">
                {t("nav.ops")}
              </Link>
            </>
          )}
          {state === "fail" && (
            <>
              <IconLock size={30} className="mx-auto mb-3 text-amber" />
              <div className="font-bold text-amber">{t("auth.verifyFail")}</div>
              <Link href="/login" className="btn btn-outline mt-6 px-6 py-2.5 text-sm">
                {t("auth.goLogin")}
              </Link>
            </>
          )}
        </div>
      </main>
    </>
  );
}
