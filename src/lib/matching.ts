import { prisma } from "./db";
import { llm, LLM_MODE } from "./llm";
import { publish } from "./bus";
import { publicProfile } from "./profile";
import type { Locale } from "./i18n-dict";
import { CONTENT } from "./content";
import { runPart, type PartLifecycleEvent, type PartTrace } from "./swarm";
import type { Prisma } from "@prisma/client";
import {
  HACK_CANDIDATE_THRESHOLD,
  type HackathonProfile,
  type MatchReport,
  type RunEvent,
  type RunEventBase,
  type VisibilityMap,
} from "./types";

const MAX_CANDIDATES = 5; // 隊伍需要更多選項

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
const pace = () => (LLM_MODE === "mock" ? sleep(650) : Promise.resolve());

type ProfileBundle = {
  userId: string;
  name: string;
  emoji: string;
  isBot: boolean;
  compiled: HackathonProfile;
  visibility: VisibilityMap | null;
};

async function loadProfile(userId: string): Promise<ProfileBundle | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!row?.profile?.compiled) return null;
  const compiled = row.profile.compiled as unknown as HackathonProfile;
  return {
    userId: row.id,
    name: row.name,
    emoji: row.emoji,
    isBot: row.isBot,
    compiled: row.profile.verification
      ? { ...compiled, github: row.profile.verification as unknown as HackathonProfile["github"] }
      : compiled,
    visibility: (row.profile.visibility as VisibilityMap) ?? null,
  };
}

/** 找出配對候選：同一場活動、有 ready 檔案、沒有進行中/既有隊伍的參賽者 */
export async function pickCandidates(
  userId: string,
  eventId: string | null,
): Promise<string[]> {
  const memberIds = eventId
    ? (
        await prisma.eventMember.findMany({
          where: { eventId },
          select: { userId: true },
        })
      ).map((m) => m.userId)
    : undefined;

  const [users, runs, teams] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { not: userId, ...(memberIds ? { in: memberIds } : {}) },
        profile: { status: "ready" },
      },
      include: { profile: true },
    }),
    prisma.matchRun.findMany({
      where: {
        status: "running",
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      select: { userAId: true, userBId: true },
    }),
    prisma.teamMember.findMany({
      where: {
        userId,
        team: { status: "assembled" },
      },
      include: { team: { include: { members: true } } },
    }),
  ]);

  const busy = new Set<string>();
  for (const r of runs) busy.add(r.userAId === userId ? r.userBId : r.userAId);
  for (const tm of teams)
    for (const m of tm.team.members)
      if (m.userId !== userId) busy.add(m.userId);

  return users
    .filter((u) => !busy.has(u.id))
    .sort((a, b) => Number(b.isBot) - Number(a.isBot))
    .slice(0, MAX_CANDIDATES)
    .map((u) => u.id);
}

/** 觸發一輪互盤：建立 run 紀錄後背景執行，回傳 run ids */
export async function startMatching(
  userId: string,
  locale: Locale = "zh",
  opts?: { faultInject?: boolean },
): Promise<string[]> {
  const me = await loadProfile(userId);
  if (!me) throw new Error("PROFILE_NOT_READY");

  const membership = await prisma.eventMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "desc" },
  });
  const eventId = membership?.eventId ?? null;

  const candidateIds = await pickCandidates(userId, eventId);
  if (candidateIds.length === 0) return [];

  const runs: string[] = [];
  for (const cid of candidateIds) {
    const run = await prisma.matchRun.create({
      data: { userAId: userId, userBId: cid, events: [], eventId },
    });
    runs.push(run.id);
    publish(`user:${userId}`, { type: "run_started", runId: run.id });
    void runPair(run.id, me, cid, locale, opts); // 背景執行
  }
  return runs;
}

async function appendEvent(runId: string, e: RunEventBase) {
  const run = await prisma.matchRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const events = (run.events as unknown as RunEvent[]) ?? [];
  const full = { ...e, ts: Date.now() } as RunEvent;
  events.push(full);
  await prisma.matchRun.update({
    where: { id: runId },
    data: { events: events as unknown as Prisma.InputJsonValue },
  });
  publish(`run:${runId}`, { type: "event", event: full });
}

export async function runPair(
  runId: string,
  me: ProfileBundle,
  candidateId: string,
  locale: Locale = "zh",
  opts?: { faultInject?: boolean },
) {
  const c = CONTENT[locale];
  try {
    const other = await loadProfile(candidateId);
    if (!other) throw new Error("candidate profile missing");

    // 蜂群即時面板：Part 生命週期事件（廣播給雙方）
    const notify = (ev: PartLifecycleEvent) => {
      const payload = {
        type: "part",
        runId,
        candidate: other.name,
        candidateEmoji: other.emoji,
        ...ev,
      };
      publish(`user:${me.userId}`, payload);
      publish(`user:${other.userId}`, payload);
    };
    const partOpts = (
      id: string,
      kind: string,
      label: string,
    ): {
      id: string;
      kind: string;
      label: string;
      runId: string;
      notify: (ev: PartLifecycleEvent) => void;
      faultOnce: boolean;
    } => ({
      id,
      kind,
      label,
      runId,
      notify,
      // demo：故障演練時讓「我的隊長作答」第一次嘗試失敗 → 重試接力
      faultOnce: Boolean(opts?.faultInject && id === `a:${runId}:A`),
    });

    const pubMe = publicProfile(me.compiled, me.visibility);
    const pubOther = publicProfile(other.compiled, other.visibility);

    await appendEvent(runId, {
      type: "phase",
      text: fill(c.phaseLink, { name: other.name }),
    });
    await pace();

    // ---- 第一輪：我的隊長提問，對方隊長回答 ----
    await appendEvent(runId, {
      type: "phase",
      text: fill(c.phaseInterview, { name: other.name }),
    });
    const providerOf = (): PartTrace => ({
      provider: LLM_MODE === "mock" ? "mock" : LLM_MODE,
      model: process.env.LLM_MODEL,
    });
    const qs1 = await runPart(
      partOpts(`q:${runId}:A`, "questions", "我的隊長提問"),
      async () => ({
        value: await llm.matchQuestions(me.compiled, pubOther, runId, locale),
        trace: providerOf(),
      }),
    );
    const ans1 = await runPart(
      partOpts(`a:${runId}:B`, "answers", "對方隊長作答"),
      async () => ({
        value: await llm.matchAnswers(other.compiled, qs1, runId, locale),
        trace: providerOf(),
      }),
    );
    for (let i = 0; i < qs1.length; i++) {
      await appendEvent(runId, { type: "question", side: "A", text: qs1[i] });
      await pace();
      await appendEvent(runId, { type: "answer", side: "B", text: ans1[i] ?? "…" });
      await pace();
    }

    // ---- 第二輪：對方隊長提問，我的隊長回答 ----
    await appendEvent(runId, {
      type: "phase",
      text: fill(c.phaseReturn, { name: other.name }),
    });
    const qs2 = await runPart(
      partOpts(`q:${runId}:B`, "questions", "對方隊長提問"),
      async () => ({
        value: await llm.matchQuestions(other.compiled, pubMe, runId, locale),
        trace: providerOf(),
      }),
    );
    const ans2 = await runPart(
      partOpts(`a:${runId}:A`, "answers", "我的隊長作答"),
      async () => ({
        value: await llm.matchAnswers(me.compiled, qs2, runId, locale),
        trace: providerOf(),
      }),
    );
    for (let i = 0; i < qs2.length; i++) {
      await appendEvent(runId, { type: "question", side: "B", text: qs2[i] });
      await pace();
      await appendEvent(runId, { type: "answer", side: "A", text: ans2[i] ?? "…" });
      await pace();
    }

    // ---- 雙方報告 ----
    const qaText = [
      ...qs1.map((q, i) => `A問：${q}\nB答：${ans1[i] ?? ""}`),
      ...qs2.map((q, i) => `B問：${q}\nA答：${ans2[i] ?? ""}`),
    ].join("\n");

    await appendEvent(runId, { type: "phase", text: c.phaseReport });
    const reportA: MatchReport = await runPart(
      partOpts(`r:${runId}:A`, "report", "我的隊長評估"),
      async () => {
        const value = await llm.matchReport(
          me.compiled,
          pubOther,
          qaText,
          `${runId}:A`,
          runId,
          locale,
        );
        return {
          value,
          trace: {
            provider: value.decisionSource
              ? value.decisionSource
              : LLM_MODE === "mock"
                ? "mock"
                : LLM_MODE,
            model: value.decisionModel ?? process.env.LLM_MODEL,
            // 決策層產出的報告：分數由 slot 直接合成 → 語義上保留率 100%
            retained: Boolean(value.decisionSource),
            answers: {
              score: value.score,
              verdict: value.verdict,
              dimensions: value.dimensions,
            },
            confidence: Math.min(...Object.values(value.dimensions)) / 100,
          } satisfies PartTrace,
        };
      },
    );
    await appendEvent(runId, { type: "report", side: "A", report: reportA });
    await pace();

    const reportB: MatchReport = await runPart(
      partOpts(`r:${runId}:B`, "report", "對方隊長評估"),
      async () => {
        const value = await llm.matchReport(
          other.compiled,
          pubMe,
          qaText,
          `${runId}:B`,
          runId,
          locale,
        );
        return {
          value,
          trace: {
            provider: value.decisionSource
              ? value.decisionSource
              : LLM_MODE === "mock"
                ? "mock"
                : LLM_MODE,
            model: value.decisionModel ?? process.env.LLM_MODEL,
            retained: Boolean(value.decisionSource),
            answers: {
              score: value.score,
              verdict: value.verdict,
              dimensions: value.dimensions,
            },
            confidence: Math.min(...Object.values(value.dimensions)) / 100,
          } satisfies PartTrace,
        };
      },
    );
    await appendEvent(runId, { type: "report", side: "B", report: reportB });

    const bothYes =
      reportA.score >= HACK_CANDIDATE_THRESHOLD &&
      reportB.score >= HACK_CANDIDATE_THRESHOLD;

    await prisma.matchRun.update({
      where: { id: runId },
      data: {
        status: "completed",
        reportA: reportA as unknown as object,
        reportB: reportB as unknown as object,
      },
    });
    await appendEvent(runId, {
      type: "done",
      matchId: null,
      text: bothYes ? c.doneYes : c.doneNo,
    });
    publish(`user:${me.userId}`, { type: "refresh" });
    publish(`user:${other.userId}`, { type: "refresh" });
  } catch (err) {
    console.error("runPair failed", err);
    await prisma.matchRun
      .update({ where: { id: runId }, data: { status: "failed" } })
      .catch(() => {});
    await appendEvent(runId, {
      type: "done",
      text: CONTENT[locale].doneError,
    }).catch(() => {});
  }
}
