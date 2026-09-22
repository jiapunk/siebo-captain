"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import { IconArrowRight, IconShield } from "@/components/Icons";
import { api, useMe } from "@/lib/client";
import { sharePlayerCardPng } from "@/lib/card";
import { useI18n } from "@/lib/i18n";
import { roleDisplay } from "@/lib/content";
import { HACK_VISIBILITY, HACK_VISIBILITY_FIELDS } from "@/lib/types";
import type { HackathonProfile, VisibilityMap } from "@/lib/types";
import type { GithubVerification } from "@/lib/github";

const FIELD_LABELS: Record<string, string> = {
  role: "主要角色",
  skills: "技術棧",
  timezone: "時區",
  availability: "可投入時間",
  goal: "參賽目標",
  workingStyle: "合作節奏",
  dealbreakers: "合作地雷",
};

export default function ProfilePage() {
  const router = useRouter();
  const { me } = useMe();
  const { t, locale } = useI18n();
  const [compiled, setCompiled] = useState<HackathonProfile | null>(null);
  const [visibility, setVisibility] = useState<VisibilityMap>({
    ...HACK_VISIBILITY,
  });
  const [saved, setSaved] = useState(false);
  const [justCompiled, setJustCompiled] = useState(false);
  const [newChip, setNewChip] = useState<Record<string, string>>({});
  const [github, setGithub] = useState<GithubVerification | null>(null);
  const [ghUsername, setGhUsername] = useState("");
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("compiled"))
      setJustCompiled(true);
    api<{
      profile: {
        status: string;
        compiled: HackathonProfile | null;
        visibility: VisibilityMap | null;
        verification: GithubVerification | null;
      };
    }>("/api/profile").then(({ profile }) => {
      if (profile.status !== "ready" || !profile.compiled) {
        router.replace("/onboarding");
        return;
      }
      setCompiled(profile.compiled);
      if (profile.visibility) setVisibility(profile.visibility);
      if (profile.verification) {
        setGithub(profile.verification);
        setGhUsername(profile.verification.username);
      }
    });
  }, [router]);

  if (!compiled)
    return (
      <>
        <AppHeader />
        <main className="flex flex-1 items-center justify-center p-8 text-muted">
          載入中…
        </main>
      </>
    );

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
    if (!v) return;
    set({ [field]: [...compiled[field], v] });
    setNewChip({ ...newChip, [field]: "" });
  };

  const chipDraft = (field: "skills" | "dealbreakers") => (v: string) =>
    setNewChip({ ...newChip, [field]: v });

  async function exportPlayerCard() {
    if (!compiled || cardBusy) return;
    setCardBusy(true);
    try {
      await sharePlayerCardPng(
        {
          name: compiled.nickname,
          emoji: me?.emoji ?? "🚀",
          role: roleDisplay(locale, compiled.role),
          skills: compiled.skills,
          goal: compiled.goal,
          availability: compiled.availability,
          workingStyle: compiled.workingStyle,
          vibe: compiled.vibe,
          bio: compiled.bio,
          verified: github
            ? {
                repos: github.publicRepos,
                langs: github.topLanguages
                  .slice(0, 2)
                  .map((x) => x.lang)
                  .join("/"),
              }
            : null,
          labels: {
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
      const { verification } = await api<{ verification: GithubVerification }>(
        "/api/profile/verify/github",
        { method: "POST", body: JSON.stringify({ username: u }) },
      );
      setGithub(verification);
    } catch (e) {
      setGhError(
        (e as Error).message === "not_found"
          ? t("prof.ghErr404")
          : t("prof.ghErr"),
      );
    } finally {
      setGhBusy(false);
    }
  }

  async function save() {
    await api("/api/profile", {
      method: "PUT",
      body: JSON.stringify({ compiled, visibility }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

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
          <div className="flex items-center justify-between p-5">
            <div>
              <div className="tag">ID CARD {"// 我的檔案"}</div>
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
              <button onClick={save} className="btn btn-ink px-5 py-2 text-sm">
                {saved ? t("prof.saved") : t("prof.save")}
              </button>
            </div>
          </div>
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
                  className="font-display w-full bg-transparent text-xl font-black outline-none"
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
              className="mt-4 w-full resize-none border border-line bg-base p-3 text-sm outline-none focus:border-phos focus:bg-panel-2"
              placeholder={t("prof.bioPh")}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Section code="SPEC" label={t("prof.spec")}>
            <Line label={t("prof.fRole")} value={compiled.role} onChange={(v) => set({ role: v })} />
            <Line label={t("prof.fTz")} value={compiled.timezone} onChange={(v) => set({ timezone: v })} />
            <Area label={t("prof.fAvail")} value={compiled.availability} onChange={(v) => set({ availability: v })} />
          </Section>

          <Section code="MISSION" label={t("prof.mission")}>
            <Area label={t("prof.fGoal")} value={compiled.goal} onChange={(v) => set({ goal: v })} />
            <Area label={t("prof.fStyle")} value={compiled.workingStyle} onChange={(v) => set({ workingStyle: v })} />
          </Section>

          <Section code="STACK" label={t("prof.stack")}>
            <ChipEditor
              items={compiled.skills}
              draft={newChip.skills ?? ""}
              onDraft={chipDraft("skills")}
              onAdd={chipAdd("skills")}
              onRemove={chipRemove("skills")}
            />
          </Section>

          <Section code="NO-GO" label={t("prof.nogo")}>
            <ChipEditor
              items={compiled.dealbreakers}
              draft={newChip.dealbreakers ?? ""}
              onDraft={chipDraft("dealbreakers")}
              onAdd={chipAdd("dealbreakers")}
              onRemove={chipRemove("dealbreakers")}
            />
          </Section>

          {/* GitHub 驗證 */}
          <Section code="VERIFY" label={t("prof.verify")} wide>
            {github && (
              <div className="relative mb-3 border border-sage bg-sage-soft p-3.5">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <IconShield size={15} className="text-sage" />
                  {t("prof.vfVerified", { u: github.username })}
                  <span className="mono ml-auto text-[9px] tracking-wider text-muted">
                    {github.source === "mock" ? "SANDBOX" : "GITHUB API"}
                  </span>
                </div>
                <div className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                  {github.note}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {github.topLanguages.slice(0, 4).map((t) => (
                    <span key={t.lang} className="chip">
                      {t.lang} ×{t.count}
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
            {ghError && <p className="mt-2 text-xs text-amber">{ghError}</p>}
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {t("prof.ghHint")}
            </p>
          </Section>

          {/* 分享範圍 */}
          <Section code="EXPOSURE" label={t("prof.exposure")} wide>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {HACK_VISIBILITY_FIELDS.map((f) => {
                const on = visibility[f] ?? true;
                return (
                  <button
                    key={f}
                    onClick={() => {
                      setVisibility({ ...visibility, [f]: !on });
                      setSaved(false);
                    }}
                    className={`flex items-center justify-between border px-3 py-2 text-xs transition ${
                      on
                        ? "border-sage bg-sage-soft text-ink"
                        : "border-line bg-base text-muted"
                    }`}
                  >
                    <span>{FIELD_LABELS[f]}</span>
                    <span className="mono text-[10px] tracking-wider">
                      {on ? "ON ▣" : "OFF ▢"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {t("prof.exposureHint")}
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
      </main>
    </>
  );
}

function ChipEditor({
  items,
  draft,
  onDraft,
  onAdd,
  onRemove,
}: {
  items: string[];
  draft: string;
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
          className="flex items-center gap-1.5 border border-line bg-base py-1 pr-1.5 pl-2.5 text-xs"
        >
          <span className="mono">{v}</span>
          <button
            onClick={() => onRemove(i)}
            className="flex h-4 w-4 items-center justify-center border border-line text-muted hover:border-line-strong hover:text-ink"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
        placeholder={t("prof.addChip")}
        className="w-24 border border-dashed border-line bg-transparent px-2 py-1 text-xs outline-none focus:border-phos"
      />
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
  onChange,
}: {
  label: string;
  value: string;
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
        className="min-w-0 flex-1 border border-line bg-base px-2.5 py-1.5 outline-none focus:border-phos focus:bg-panel-2"
      />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
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
        className="w-full resize-none border border-line bg-base px-2.5 py-1.5 text-sm outline-none focus:border-phos focus:bg-panel-2"
      />
    </label>
  );
}
