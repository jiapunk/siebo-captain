"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { IconArrowRight, IconShield } from "@/components/Icons";
import { api, useMe } from "@/lib/client";
import { sharePlayerCardPng } from "@/lib/card";
import { apiErrorMessage, useI18n } from "@/lib/i18n";
import { roleDisplay } from "@/lib/content";
import { HACK_VISIBILITY, HACK_VISIBILITY_FIELDS } from "@/lib/types";
import type { HackathonProfile, VisibilityMap } from "@/lib/types";
import type { GithubVerification } from "@/lib/github";

/** 分享範圍標籤：用字典現成的 prof.v* */
const FIELD_LABEL_KEYS: Record<string, string> = {
  role: "prof.vRole",
  skills: "prof.vSkills",
  timezone: "prof.vTz",
  availability: "prof.vAvail",
  goal: "prof.vGoal",
  workingStyle: "prof.vStyle",
  dealbreakers: "prof.vNogo",
  nickname: "b.prof.fNickname",
  vibe: "b.prof.fVibe",
  bio: "prof.bioPh",
};

/** 與 PUT /api/profile 的驗證上限一致（字元數；陣列為 [最多幾項, 每項上限]） */
const MAX = {
  nickname: 60,
  role: 60,
  timezone: 80,
  availability: 120,
  goal: 200,
  workingStyle: 200,
  bio: 2000,
} as const;
const CHIP_MAX = { skills: [30, 80], dealbreakers: [20, 300] } as const;

/** GitHub 比對的錯誤碼 → 文案 key（too_many_attempts 等通用碼交給 apiErrorMessage） */
const GH_ERRORS: Record<string, string> = {
  invalid_username: "b.gh.errInvalid",
  profile_missing: "b.gh.errProfile",
  not_found: "prof.ghErr404",
  fetch_failed: "prof.ghErr",
};

type ApiError = Error & { status?: number; body?: Record<string, unknown> };

/** 像 api()，但失敗時把回應 body 掛在 error 上（要讀 field / retryAfterSec） */
async function apiWithBody<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(
      typeof body.error === "string" ? body.error : res.statusText,
    ) as ApiError;
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

export default function ProfilePage() {
  // useSearchParams 需要 Suspense 邊界
  return (
    <Suspense fallback={<AppHeader />}>
      <ProfileInner />
    </Suspense>
  );
}

function ProfileInner() {
  const router = useRouter();
  const justCompiled = useSearchParams().has("compiled");
  const { me } = useMe();
  const { t, locale } = useI18n();
  const [compiled, setCompiled] = useState<HackathonProfile | null>(null);
  const [visibility, setVisibility] = useState<VisibilityMap>({
    ...HACK_VISIBILITY,
  });
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newChip, setNewChip] = useState<Record<string, string>>({});
  const [github, setGithub] = useState<GithubVerification | null>(null);
  const [ghUsername, setGhUsername] = useState("");
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [delStage, setDelStage] = useState<"idle" | "confirm" | "deleting">("idle");
  const [delError, setDelError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{
      profile: {
        status: string;
        compiled: HackathonProfile | null;
        visibility: VisibilityMap | null;
        verification: GithubVerification | null;
      };
    }>("/api/profile")
      .then(({ profile }) => {
        if (cancelled) return;
        if (profile.status !== "ready" || !profile.compiled) {
          router.replace("/onboarding");
          return;
        }
        setLoadError(null);
        setCompiled(profile.compiled);
        if (profile.visibility) setVisibility(profile.visibility);
        if (profile.verification) {
          setGithub(profile.verification);
          setGhUsername(profile.verification.username);
        }
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        // 未登入（或帳號已刪除）→ 回首頁，跟其他頁一致
        if (e.status === 401) router.replace("/");
        else setLoadError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [router, reloadKey]);

  if (!compiled)
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-muted">
          {loadError != null ? (
            <>
              <p role="alert" className="text-sm text-amber">
                {apiErrorMessage(t, loadError)}
              </p>
              <button
                onClick={() => {
                  setLoadError(null);
                  setReloadKey((k) => k + 1);
                }}
                className="btn btn-outline px-5 py-2 text-sm"
              >
                {t("b.retry")}
              </button>
            </>
          ) : (
            t("b.loading")
          )}
        </main>
      </>
    );

  /** 欄位目前是否對外（沒存過的欄位用預設值；dealbreakers 預設不公開，與伺服器一致） */
  const isOn = (f: string) => visibility[f] ?? HACK_VISIBILITY[f] ?? true;

  const set = (patch: Partial<HackathonProfile>) => {
    setCompiled({ ...compiled, ...patch });
    setSaved(false);
  };

  const chipRemove = (field: "skills" | "dealbreakers") => (i: number) => {
    const arr = [...compiled[field]];
    arr.splice(i, 1);
    set({ [field]: arr });
  };

  const chipAdd = (field: "skills" | "dealbreakers") => () => {
    const v = (newChip[field] ?? "").trim();
    if (!v || compiled[field].length >= CHIP_MAX[field][0]) return;
    set({ [field]: [...compiled[field], v.slice(0, CHIP_MAX[field][1])] });
    setNewChip({ ...newChip, [field]: "" });
  };

  const chipDraft = (field: "skills" | "dealbreakers") => (v: string) =>
    setNewChip({ ...newChip, [field]: v });

  async function exportPlayerCard() {
    if (!compiled || cardBusy) return;
    setCardBusy(true);
    setCardError(null);
    try {
      // 只畫出分享範圍中開啟的欄位（暱稱、vibe、簡介不在分享範圍設定內，一律顯示）
      await sharePlayerCardPng(
        {
          name: compiled.nickname,
          emoji: me?.emoji ?? "🚀",
          role: isOn("role") ? roleDisplay(locale, compiled.role) : "",
          skills: isOn("skills") ? compiled.skills : [],
          goal: isOn("goal") ? compiled.goal : "",
          availability: isOn("availability") ? compiled.availability : "",
          workingStyle: isOn("workingStyle") ? compiled.workingStyle : "",
          vibe: compiled.vibe,
          bio: compiled.bio,
          verified: github
            ? {
                repos: github.publicRepos,
                langs: (github.topLanguages ?? [])
                  .slice(0, 2)
                  .map((x) => x.lang)
                  .join("/"),
              }
            : null,
          locale,
          labels: {
            brand: t("brand.name"),
            title: t("pcard.title"),
            subtitle: t("pcard.subtitle"),
            skills: t("pcard.skills"),
            goal: t("pcard.goal"),
            avail: t("pcard.avail"),
            style: t("pcard.style"),
            verified: t("pcard.verified"),
            footer: t("pcard.footer"),
            scan: "",
          },
        },
        `siebo-player-${compiled.nickname}.png`,
      );
    } catch (e) {
      setCardError(apiErrorMessage(t, e, "b.prof.cardErr"));
    } finally {
      setCardBusy(false);
    }
  }

  async function verifyGithub() {
    const u = ghUsername.trim();
    if (!u || ghBusy) return;
    setGhBusy(true);
    setGhError(null);
    try {
      const { verification } = await apiWithBody<{ verification: GithubVerification }>(
        "/api/profile/verify/github",
        { method: "POST", body: JSON.stringify({ username: u }) },
      );
      setGithub(verification);
    } catch (e) {
      const err = e as ApiError;
      const sec = Number(err.body?.retryAfterSec);
      setGhError(
        err.message === "rate_limited"
          ? Number.isFinite(sec) && sec > 0
            ? t("b.gh.errRateSec", { sec: Math.ceil(sec) })
            : t("b.gh.errRate")
          : GH_ERRORS[err.message]
            ? t(GH_ERRORS[err.message])
            : apiErrorMessage(t, e, "prof.ghErr"),
      );
    } finally {
      setGhBusy(false);
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiWithBody("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ compiled, visibility }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) {
        router.replace("/");
        return;
      }
      if (err.message === "invalid_profile") {
        const field = String(err.body?.field ?? "");
        const name = field.replace(/^(compiled|visibility)\./, "");
        const key = field.startsWith("visibility")
          ? "prof.exposure"
          : FIELD_LABEL_KEYS[name];
        setSaveError(t("b.prof.errInvalid", { field: key ? t(key) : name || "—" }));
      } else setSaveError(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  // 種子角色（seed-*／模擬隊友）是 demo 固定班底，後端回 403 seed_identity
  const canDelete = Boolean(me && !me.isBot && !me.id.startsWith("seed-"));

  async function deleteAccount() {
    setDelStage("deleting");
    setDelError(null);
    try {
      await api("/api/me", { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch (e) {
      const code = (e as Error).message;
      setDelError(
        code === "seed_identity" ? t("b.del.seed") : apiErrorMessage(t, e),
      );
      setDelStage("confirm");
    }
  }

  const ghMatched = github?.matchedSkills ?? [];
  const ghUnmatched = github?.unmatchedSkills ?? [];
  const ghUnverifiable = github?.unverifiableSkills ?? [];
  const sep = t("b.listSep");

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl flex-1 px-4 pb-16">
        {justCompiled && (
          <div className="rise-in mt-6 border border-sage bg-sage-soft p-4 text-sm text-ink-soft">
            {t("prof.banner")}
          </div>
        )}

        <div className="card cut mt-8">
          <div className="ticks-x" />
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <div className="tag">{t("prof.tag")}</div>
              <h1 className="font-display mt-1.5 text-xl font-black">
                {t("prof.title")}
              </h1>
            </div>
            <div className="flex gap-2">
              <button
                onClick={exportPlayerCard}
                disabled={cardBusy}
                className="btn btn-outline px-4 py-2 text-sm disabled:opacity-50"
              >
                {cardBusy ? t("pcard.exporting") : t("pcard.export")}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="btn btn-ink px-5 py-2 text-sm disabled:opacity-60"
              >
                {saved ? t("prof.saved") : saving ? "…" : t("prof.save")}
              </button>
            </div>
          </div>
          {(saveError || cardError) && (
            <div role="alert" className="border-t border-line px-5 py-2.5 text-xs text-amber">
              {saveError ?? cardError}
            </div>
          )}
        </div>

        {/* 主卡 */}
        <div className="card cut mt-4">
          <div className="p-5">
            <div className="flex items-center gap-4">
              <span className="flex h-16 w-16 items-center justify-center border border-line-strong bg-base text-3xl">
                {me?.emoji ?? "🙂"}
              </span>
              <div className="min-w-0 flex-1">
                <input
                  value={compiled.nickname}
                  onChange={(e) => set({ nickname: e.target.value })}
                  aria-label={t("b.prof.fNickname")}
                  placeholder={t("b.prof.fNickname")}
                  maxLength={MAX.nickname}
                  className="font-display w-full bg-transparent text-xl font-black outline-none placeholder:text-muted/60"
                />
                <div className="mono mt-1 text-[11px] tracking-wider text-accent-deep">
                  {compiled.vibe}
                </div>
              </div>
            </div>
            <textarea
              value={compiled.bio}
              onChange={(e) => set({ bio: e.target.value })}
              rows={2}
              maxLength={MAX.bio}
              aria-label={t("prof.bioPh")}
              className="mt-4 w-full resize-none border border-line bg-base p-3 text-sm outline-none focus:border-phos focus:bg-panel-2"
              placeholder={t("prof.bioPh")}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Section code="SPEC" label={t("prof.spec")}>
            <Line label={t("prof.fRole")} value={compiled.role} max={MAX.role} onChange={(v) => set({ role: v })} />
            <Line label={t("prof.fTz")} value={compiled.timezone} max={MAX.timezone} onChange={(v) => set({ timezone: v })} />
            <Area label={t("prof.fAvail")} value={compiled.availability} max={MAX.availability} onChange={(v) => set({ availability: v })} />
          </Section>

          <Section code="MISSION" label={t("prof.mission")}>
            <Area label={t("prof.fGoal")} value={compiled.goal} max={MAX.goal} onChange={(v) => set({ goal: v })} />
            <Area label={t("prof.fStyle")} value={compiled.workingStyle} max={MAX.workingStyle} onChange={(v) => set({ workingStyle: v })} />
          </Section>

          <Section code="STACK" label={t("prof.stack")}>
            <ChipEditor
              label={t("prof.vSkills")}
              items={compiled.skills}
              draft={newChip.skills ?? ""}
              maxLen={CHIP_MAX.skills[1]}
              full={compiled.skills.length >= CHIP_MAX.skills[0]}
              onDraft={chipDraft("skills")}
              onAdd={chipAdd("skills")}
              onRemove={chipRemove("skills")}
            />
          </Section>

          <Section code="NO-GO" label={t("prof.nogo")}>
            <ChipEditor
              label={t("prof.vNogo")}
              items={compiled.dealbreakers}
              draft={newChip.dealbreakers ?? ""}
              maxLen={CHIP_MAX.dealbreakers[1]}
              full={compiled.dealbreakers.length >= CHIP_MAX.dealbreakers[0]}
              onDraft={chipDraft("dealbreakers")}
              onAdd={chipAdd("dealbreakers")}
              onRemove={chipRemove("dealbreakers")}
            />
          </Section>

          {/* GitHub 公開資料比對（不證明帳號所有權） */}
          <Section code="VERIFY" label={t("prof.verify")} wide>
            {github && (
              <div className="relative mb-3 border border-sage bg-sage-soft p-3.5">
                <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  <IconShield size={15} className="text-sage" />
                  {t("prof.vfVerified", { u: github.username })}
                  <span className="mono ml-auto text-[9px] tracking-wider text-muted">
                    {github.source === "mock" ? "SANDBOX" : "GITHUB API"}
                  </span>
                </div>
                {/* ownershipVerified 目前永遠是 false（舊資料沒有這欄也視為 false） */}
                <div className="mono mt-1 text-[10px] tracking-wider text-amber">
                  {t("b.gh.ownership")}
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs leading-relaxed text-ink-soft">
                  <p>
                    {github.publicRepos > 0
                      ? t("b.gh.repos", {
                          n: github.publicRepos,
                          langs:
                            (github.topLanguages ?? [])
                              .map((x) => `${x.lang} (${x.count})`)
                              .join(sep) || "—",
                        })
                      : t("b.gh.noRepos")}
                  </p>
                  {ghMatched.length > 0 && (
                    <p>{t("b.gh.matched", { list: ghMatched.slice(0, 4).join(sep) })}</p>
                  )}
                  {ghUnmatched.length > 0 && (
                    <p className="text-amber">
                      {t("b.gh.unmatched", { list: ghUnmatched.slice(0, 4).join(sep) })}
                    </p>
                  )}
                  {ghUnverifiable.length > 0 && (
                    <p className="text-muted">
                      {t("b.gh.unverifiable", {
                        list: ghUnverifiable.slice(0, 4).join(sep),
                      })}
                    </p>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(github.topLanguages ?? []).slice(0, 4).map((x) => (
                    <span key={x.lang} className="chip">
                      {x.lang} ×{x.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={ghUsername}
                onChange={(e) => setGhUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && verifyGithub()}
                placeholder={t("prof.ghPh")}
                aria-label={t("prof.ghPh")}
                maxLength={100}
                autoComplete="off"
                className="mono min-w-0 flex-1 border border-line-strong bg-base px-3 py-2 text-sm outline-none focus:bg-panel-2"
              />
              <button
                onClick={verifyGithub}
                disabled={ghBusy || !ghUsername.trim()}
                className="btn btn-ink px-5 py-2 text-sm disabled:opacity-40"
              >
                {ghBusy ? t("prof.ghBusy") : github ? t("prof.ghReverify") : t("prof.ghVerify")}
              </button>
            </div>
            {ghError && (
              <p role="alert" className="mt-2 text-xs text-amber">
                {ghError}
              </p>
            )}
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {t("prof.ghHint")}
            </p>
          </Section>

          {/* 分享範圍 */}
          <Section code="EXPOSURE" label={t("prof.exposure")} wide>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {HACK_VISIBILITY_FIELDS.map((f) => {
                const on = isOn(f);
                return (
                  <button
                    key={f}
                    aria-pressed={on}
                    onClick={() => {
                      setVisibility({ ...visibility, [f]: !on });
                      setSaved(false);
                    }}
                    className={`flex min-h-10 items-center justify-between border px-3 py-2 text-xs transition ${
                      on
                        ? "border-sage bg-sage-soft text-ink"
                        : "border-line bg-base text-muted"
                    }`}
                  >
                    <span>{t(FIELD_LABEL_KEYS[f])}</span>
                    <span aria-hidden="true" className="mono text-[10px] tracking-wider">
                      {on ? "ON ▣" : "OFF ▢"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {t("prof.exposureHint")}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              {t("b.prof.cardScope")}
            </p>
          </Section>
        </div>

        <div className="mt-8 flex justify-center">
          <button
            onClick={() => router.push("/agent")}
            className="btn btn-accent px-8 py-3"
          >
            {t("prof.go")}
            <IconArrowRight size={17} />
          </button>
        </div>

        {/* 刪除帳號與資料（二次確認） */}
        <section
          aria-labelledby="danger-zone-title"
          className="mt-12 border border-alert/50 p-4"
        >
          <div className="mono text-[10px] tracking-[0.16em] text-alert">
            DANGER ZONE
          </div>
          <h2 id="danger-zone-title" className="mt-1 text-sm font-bold">
            {t("b.del.title")}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {canDelete ? t("b.del.desc") : t("b.del.seed")}
          </p>
          {canDelete && delStage === "idle" && (
            <button
              onClick={() => setDelStage("confirm")}
              className="btn mt-3 border border-alert/60 px-4 py-2 text-sm text-alert hover:bg-alert-soft"
            >
              {t("b.del.button")}
            </button>
          )}
          {canDelete && delStage !== "idle" && (
            <div role="alertdialog" aria-labelledby="danger-confirm" className="mt-3 border border-alert bg-alert-soft p-3">
              <p id="danger-confirm" className="text-sm text-ink">
                {t("b.del.confirm")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={deleteAccount}
                  disabled={delStage === "deleting"}
                  className="btn btn-accent px-4 py-2 text-sm disabled:opacity-60"
                >
                  {delStage === "deleting" ? t("b.del.deleting") : t("b.del.confirmBtn")}
                </button>
                <button
                  onClick={() => {
                    setDelStage("idle");
                    setDelError(null);
                  }}
                  disabled={delStage === "deleting"}
                  className="btn btn-outline px-4 py-2 text-sm"
                >
                  {t("b.cancel")}
                </button>
              </div>
            </div>
          )}
          {delError && (
            <p role="alert" className="mt-2 text-xs text-amber">
              {delError}
            </p>
          )}
        </section>
      </main>
    </>
  );
}

function ChipEditor({
  label,
  items,
  draft,
  maxLen,
  full,
  onDraft,
  onAdd,
  onRemove,
}: {
  label: string;
  items: string[];
  draft: string;
  maxLen: number;
  full: boolean;
  onDraft: (v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="flex items-center gap-1.5 border border-line bg-base py-1 pr-1 pl-2.5 text-xs"
        >
          <span className="mono">{v}</span>
          <button
            onClick={() => onRemove(i)}
            aria-label={t("b.prof.removeChip", { v })}
            className="flex h-7 w-7 items-center justify-center border border-line text-muted hover:border-line-strong hover:text-ink"
          >
            ×
          </button>
        </span>
      ))}
      {!full && (
        <input
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && onAdd()}
          placeholder={t("prof.addChip")}
          aria-label={t("b.prof.addChipAria", { field: label })}
          maxLength={maxLen}
          className="min-h-9 w-24 border border-dashed border-line bg-transparent px-2 py-1 text-xs outline-none focus:border-phos"
        />
      )}
    </div>
  );
}

function Section({
  code,
  label,
  children,
  wide,
}: {
  code: string;
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`card cut p-4 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="mono text-[10px] tracking-[0.16em] text-accent">
          {code}
        </span>
        <span className="tag">{label}</span>
      </div>
      {children}
    </div>
  );
}

function Line({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="mb-2 flex items-center gap-3 text-sm last:mb-0">
      <span className="mono w-14 shrink-0 text-[10px] tracking-wider text-muted">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        className="min-w-0 flex-1 border border-line bg-base px-2.5 py-1.5 outline-none focus:border-phos focus:bg-panel-2"
      />
    </label>
  );
}

function Area({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="mb-2 block text-sm last:mb-0">
      {label && (
        <span className="mono mb-1 block text-[10px] tracking-wider text-muted">
          {label}
        </span>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={max}
        className="w-full resize-none border border-line bg-base px-2.5 py-1.5 text-sm outline-none focus:border-phos focus:bg-panel-2"
      />
    </label>
  );
}
