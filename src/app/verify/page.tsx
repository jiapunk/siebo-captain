"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/client";
import { useI18n } from "@/lib/i18n";
import { IconCheck, IconLock } from "@/components/Icons";

export default function VerifyPage() {
  const { t } = useI18n();
  const [state, setState] = useState<"working" | "ok" | "fail">("working");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("fail");
      return;
    }
    const attempt = () =>
      api("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
    attempt()
      .catch(() => new Promise((r) => setTimeout(r, 1500)).then(attempt))
      .then(() => setState("ok"))
      .catch(() => setState("fail"));
  }, []);

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
