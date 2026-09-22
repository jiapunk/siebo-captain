"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, useMe, type Me } from "@/lib/client";
import { IconCompass, IconUser, IconUsers, IconRadar } from "./Icons";
import LocaleSwitcher from "./LocaleSwitcher";
import { useI18n } from "@/lib/i18n";

interface UserRow extends Me {
  tagline: string;
}

export default function AppHeader() {
  const { me, loading, authMode } = useMe();
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open)
      api<{ users: UserRow[] }>("/api/users").then((d) => setUsers(d.users));
  }, [open]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function resendVerify() {
    if (resending) return;
    setResending(true);
    try {
      const res = await api<{ devVerifyUrl?: string | null }>(
        "/api/auth/resend-verify",
        { method: "POST" },
      );
      if (res.devVerifyUrl) setVerifyUrl(res.devVerifyUrl);
    } finally {
      setResending(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  async function switchTo(id: string) {
    await api("/api/session", {
      method: "POST",
      body: JSON.stringify({ userId: id }),
    });
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  const nav = [
    { href: "/agent", label: t("nav.ops"), code: "OPS", icon: IconCompass },
    { href: "/people", label: t("nav.radar"), code: "RADAR", icon: IconRadar },
    { href: "/teams", label: t("nav.squad"), code: "SQUAD", icon: IconUsers },
    { href: "/profile", label: t("nav.id"), code: "ID", icon: IconUser },
  ];

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-line bg-console/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-3 sm:px-4">
          {/* 品牌 */}
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center border border-phos">
              <span className="led led-live" />
            </span>
            <span className="font-display whitespace-nowrap text-base font-black tracking-wide text-ink sm:text-lg">
              {t("brand.name")}
            </span>
            <span className="mono hidden whitespace-nowrap text-[10px] tracking-[0.22em] text-muted lg:inline">
              {t("brand.sub")}
            </span>
          </Link>

          {/* 桌機導覽 */}
          {me && (
            <nav className="ml-2 hidden items-center md:flex">
              {nav.map((n) => {
                const Icon = n.icon;
                const active = pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`relative flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm transition ${
                      active ? "text-phos" : "text-ink-soft hover:text-ink"
                    }`}
                  >
                    <Icon size={15} />
                    {n.label}
                    <span className="mono hidden text-[9px] tracking-[0.18em] opacity-50 xl:inline">
                      {n.code}
                    </span>
                    {active && (
                      <span className="absolute inset-x-2 -bottom-[1px] h-[2px] bg-phos" />
                    )}
                  </Link>
                );
              })}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-2" ref={ref}>
            <LocaleSwitcher compact />
            {loading ? null : me ? (
              <div className="relative">
                <button
                  onClick={() => setOpen(!open)}
                  aria-label={`${t("identity.title")}：${me.name}`}
                  className="flex items-center gap-2 border border-line bg-panel px-2 py-1.5 text-sm text-ink transition hover:border-phos"
                >
                  <span className="text-base leading-none">{me.emoji}</span>
                  <span className="hidden max-w-24 truncate sm:inline">
                    {me.name}
                  </span>
                  <span className="mono text-[9px] text-muted">▼</span>
                </button>
                {open && (
                  <div className="card rise-in absolute right-0 mt-2 max-h-[70vh] w-72 overflow-y-auto">
                    <div className="border-b border-line px-3 py-2">
                      <div className="tag">{t("identity.title")}</div>
                      {authMode === "session" ? (
                        <div className="mono mt-1 truncate text-xs text-ink-soft">
                          {me.email ?? "—"}
                        </div>
                      ) : (
                        <div className="mono mt-1 text-xs text-ink-soft">
                          {t("identity.demoMode")}
                        </div>
                      )}
                      {authMode === "session" && (
                        <button
                          onClick={logout}
                          className="mono mt-2 w-full border border-line px-2 py-2 text-left text-xs tracking-wider transition hover:border-alert hover:text-alert"
                        >
                          {t("identity.logout")}
                        </button>
                      )}
                    </div>
                    <div className="tag px-3 pt-2.5 pb-1">
                      {t("identity.switch")}
                    </div>
                    {users
                      .filter((u) => u.id !== me.id)
                      .map((u) => (
                        <button
                          key={u.id}
                          onClick={() => switchTo(u.id)}
                          className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-panel"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-line text-base">
                            {u.emoji}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-bold">
                              {u.name}
                              {u.isBot && (
                                <span className="mono ml-1.5 border border-line px-1 py-0.5 text-[9px] font-normal text-muted">
                                  SIM
                                </span>
                              )}
                            </span>
                            <span className="mono block truncate text-[11px] text-muted">
                              {u.tagline}
                            </span>
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <Link href="/" className="btn btn-outline px-3 py-1.5 text-sm">
                {t("identity.select")}
              </Link>
            )}
          </div>
        </div>

        {/* 桌機語言切換在右側已含；行動裝置導覽列如下 */}
      </header>

      {/* Email 未驗證橫幅 */}
      {me?.email && me.emailVerified === false && (
        <div className="border-b border-amber bg-amber-soft">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-3 py-2 sm:px-4">
            <span className="text-xs text-ink-soft">
              {t("auth.unverifiedBanner")}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {verifyUrl ? (
                <a
                  href={verifyUrl}
                  className="mono border border-amber px-3 py-1 text-[11px] tracking-wider text-amber hover:bg-amber/10"
                >
                  {t("auth.openVerify")}
                </a>
              ) : (
                <button
                  onClick={resendVerify}
                  disabled={resending}
                  className="mono border border-amber px-3 py-1 text-[11px] tracking-wider text-amber hover:bg-amber/10 disabled:opacity-50"
                >
                  {resending ? "…" : t("auth.resend")}
                </button>
              )}
            </span>
          </div>
        </div>
      )}

      {/* 行動底部 Dock */}
      {me && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-line bg-console/95 backdrop-blur-sm md:hidden">
          {nav.map((n) => {
            const Icon = n.icon;
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 ${
                  active ? "text-phos" : "text-muted"
                }`}
              >
                {active && (
                  <span className="absolute top-0 h-[2px] w-10 bg-phos" />
                )}
                <Icon size={18} />
                <span className="text-[10px] leading-none">{n.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
