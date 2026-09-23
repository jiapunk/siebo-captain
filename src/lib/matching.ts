import { prisma } from "./db";
import { llm, localLlm, LLM_MODE } from "./llm";
import { publish } from "./bus";
import { profileFromRow, publicProfile, type PublicProfile } from "./profile";
import type { Locale } from "./i18n-dict";
import { CONTENT } from "./content";
import {
  runPartDetailed,
  type PartLifecycleEvent,
  type PartTrace,
  type RunPartOptions,
} from "./swarm";
import { bothPass } from "./pairGate";
import type {
  HackathonProfile,
  MatchReport,
  RunEvent,
  RunEventBase,
  VisibilityMap,
} from "./types";

const MAX_CANDIDATES = 5; // 隊伍需要更多選項
/**
 * running 超過這個時間就視為中斷（行程重啟、崩潰），收尾成 failed，對手不再被卡住。
 * 與 costGuard.STALE_RUN_MS 同值；runPair 的「降級」讓單場最壞耗時遠低於此（見 runPair）。
 */
export const STALE_RUN_MS = 10 * 60_000;

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
  return {
    userId: row.id,
    name: row.name,
    emoji: row.emoji,
    isBot: row.isBot,
    // compiled.github 一律忽略；GitHub 驗證只取伺服器寫入的 verification row
    compiled: profileFromRow(row.profile.compiled, row.profile.verification),
    visibility: (row.profile.visibility as VisibilityMap) ?? null,
  };
}

/** 把卡在 running 太久的 run 收尾成 failed（行程重啟／崩潰後的回收） */
export async function reapStaleRuns(userId?: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  const res = await prisma.matchRun.updateMany({
    where: {
      status: "running",
      createdAt: { lt: cutoff },
      ...(userId ? { OR: [{ userAId: userId }, { userBId: userId }] } : {}),
    },
    data: { status: "failed" },
  });
  return res.count;
}

export interface CandidateInfo {
  id: string;
  isBot: boolean;
  /** 最近一次跟我完成互盤的時間（任一方向）；沒有互盤過為 null */
  lastMatchedAt: number | null;
}

/**
 * 候選排序（純函式）：
 *   ① 還沒跟我互盤過的真人 → ② 還沒互盤過的 bot → ③ 互盤過的（真人優先、最久以前的先）
 * 取前 limit 位。
 */
export function rankCandidates(list: CandidateInfo[], limit = MAX_CANDIDATES): string[] {
  return [...list]
    .sort((a, b) => {
      const ma = a.lastMatchedAt === null ? 0 : 1;
      const mb = b.lastMatchedAt === null ? 0 : 1;
      if (ma !== mb) return ma - mb;
      if (a.isBot !== b.isBot) return Number(a.isBot) - Number(b.isBot);
      const ta = a.lastMatchedAt ?? 0;
      const tb = b.lastMatchedAt ?? 0;
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, limit)
    .map((c) => c.id);
}

/** 找出配對候選：同一場活動、有 ready 檔案、沒有進行中互盤、不是已成隊隊友 */
export async function pickCandidates(
  userId: string,
  eventId: string | null,
): Promise<string[]> {
  await reapStaleRuns(userId);
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
      select: { id: true, isBot: true },
    }),
    prisma.matchRun.findMany({
      where: {
        status: { in: ["running", "completed"] },
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      select: { userAId: true, userBId: true, status: true, createdAt: true },
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
  const lastMatched = new Map<string, number>();
  for (const r of runs) {
    const other = r.userAId === userId ? r.userBId : r.userAId;
    if (r.status === "running") busy.add(other);
    else {
      const t = r.createdAt.getTime();
      if ((lastMatched.get(other) ?? 0) < t) lastMatched.set(other, t);
    }
  }
  for (const tm of teams)
    for (const m of tm.team.members)
      if (m.userId !== userId) busy.add(m.userId);

  return rankCandidates(
    users
      .filter((u) => !busy.has(u.id))
      .map((u) => ({ id: u.id, isBot: u.isBot, lastMatchedAt: lastMatched.get(u.id) ?? null })),
  );
}

// ---- 同一使用者的 startMatching 序列化：避免兩個並行請求挑到同一批候選 ----
const lockStore = globalThis as unknown as { __matchLocks?: Map<string, Promise<void>> };
const matchLocks: Map<string, Promise<void>> =
  lockStore.__matchLocks ?? (lockStore.__matchLocks = new Map());

async function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = matchLocks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  matchLocks.set(userId, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (matchLocks.get(userId) === chained) matchLocks.delete(userId);
  }
}

/** 觸發一輪互盤：建立 run 紀錄後背景執行，回傳 run ids */
export async function startMatching(
  userId: string,
  locale: Locale = "zh",
  opts?: { faultInject?: boolean },
): Promise<string[]> {
  return withUserLock(userId, async () => {
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
      // 背景執行（單行程自架）；runPair 自己保證任何例外都把 run 收尾成 failed
      void runPair(run.id, me, cid, locale, opts).catch((e) =>
        console.error("runPair escaped", e),
      );
    }
    return runs;
  });
}

/**
 * 追加一筆逐字稿事件：單一 UPDATE 以 SQLite json_insert 原子追加（不是 read-modify-write），
 * 同一個 run 並行寫入也不會互相覆蓋而丟事件（tests/unit/append-event.test.ts 鎖住）。
 * run 不存在 → 什麼都不做（不廣播）。
 */
export async function appendEvent(runId: string, e: RunEventBase) {
  const full = { ...e, ts: Date.now() } as RunEvent;
  const updated = await prisma.$executeRaw`
    UPDATE "MatchRun"
    SET "events" = json_insert(COALESCE("events", '[]'), '$[#]', json(${JSON.stringify(full)}))
    WHERE "id" = ${runId}`;
  if (updated === 0) return;
  publish(`run:${runId}`, { type: "event", event: full });
}

// ---- Part 回傳值驗證：不完整就 throw（觸發重試 → 本機退路），不會「先標 done 再崩潰」 ----
function assertStrings(v: unknown, min: number, what: string): asserts v is string[] {
  if (!Array.isArray(v) || v.length < min || v.some((x) => typeof x !== "string" || !x.trim()))
    throw new Error(`invalid ${what}`);
}
function assertReport(v: MatchReport): void {
  const nums = [v?.score, ...Object.values(v?.dimensions ?? {})];
  if (
    !v ||
    nums.length !== 6 ||
    nums.some((n) => typeof n !== "number" || !Number.isFinite(n)) ||
    !["recommend", "cautious", "pass"].includes(v.verdict) ||
    typeof v.summaryForUser !== "string"
  )
    throw new Error("invalid report");
}

/** 報告 Part 的軌跡：RETAIN 用量測結果（real 模式沒有決策 slot → 不可量測＝null） */
function reportTrace(value: MatchReport): PartTrace {
  return {
    provider: value.decisionSource
      ? value.decisionSource
      : LLM_MODE === "mock"
        ? "mock"
        : LLM_MODE,
    model: value.decisionModel ?? process.env.LLM_MODEL,
    retained: value.retention ? value.retention.retained : undefined,
    answers: {
      score: value.score,
      verdict: value.verdict,
      dimensions: value.dimensions,
      fallbackCount: value.fallbackCount ?? null,
      decisionCoverage: value.decisionCoverage ?? null,
      retention: value.retention ?? null,
    },
    confidence: Math.min(...Object.values(value.dimensions)) / 100,
  };
}

export async function runPair(
  runId: string,
  me: ProfileBundle,
  candidateId: string,
  locale: Locale = "zh",
  opts?: { faultInject?: boolean },
) {
  const c = CONTENT[locale] ?? CONTENT.zh;
  let otherUserId: string | null = null;
  try {
    const other = await loadProfile(candidateId);
    if (!other) throw new Error("candidate profile missing");
    otherUserId = other.userId;

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
    const partOpts = <T,>(id: string, kind: string, label: string): RunPartOptions<T> => ({
      id,
      kind,
      label,
      runId,
      notify,
      // demo：故障演練時讓「我的隊長作答」第一次嘗試失敗 → 重試接力
      faultOnce: Boolean(opts?.faultInject && id === `a:${runId}:A`),
    });

    // 分享權限：逐字稿、雙方報告都會廣播給兩邊，也會送進 LLM／Jev，
    // 所以六個 Part 一律只用 publicProfile 投影（自己這一側也是）。
    const pubMe: PublicProfile = publicProfile(me.compiled, me.visibility);
    const pubOther: PublicProfile = publicProfile(other.compiled, other.visibility);

    await appendEvent(runId, {
      type: "phase",
      text: fill(c.phaseLink, { name: other.name }),
    });
    await pace();

    const providerOf = (): PartTrace => ({
      provider: LLM_MODE === "mock" ? "mock" : LLM_MODE,
      model: LLM_MODE === "mock" ? undefined : process.env.LLM_MODEL,
    });
    const localTrace: PartTrace = { provider: "mock" };

    // 降級：本場有任何 Part 已經退回本機腳本（LLM 重試後仍失敗），後面的 LLM Part 直接用本機腳本，
    // 不再每個 Part 各等一輪逾時 → 單場最壞耗時約「一個 Part 的重試預算」而不是四倍。
    let degraded = false;
    const degradedTrace: PartTrace = {
      provider: "mock",
      fallback: true,
      note: "run degraded after an earlier LLM failure",
    };
    const pick = <T,>(remote: () => Promise<T>, local: () => Promise<T>) =>
      degraded
        ? local().then((value) => ({ value, trace: degradedTrace }))
        : remote().then((value) => ({ value, trace: providerOf() }));

    const askPart = async (id: string, label: string, self: PublicProfile, them: PublicProfile) => {
      const local = () => localLlm.matchQuestions(self, them, runId, locale);
      const { value, meta } = await runPartDetailed<string[]>(
        {
          ...partOpts<string[]>(id, "questions", label),
          validate: (v) => assertStrings(v, 1, "questions"),
          // LLM 重試後仍失敗 → 本機腳本產生（provider=mock，note 記 fallback）
          fallback: async () => ({ value: await local(), trace: localTrace }),
        },
        () => pick(() => llm.matchQuestions(self, them, runId, locale), local),
      );
      if (meta.fallback) degraded = true;
      return value;
    };
    const answerPart = async (id: string, label: string, self: PublicProfile, qs: string[]) => {
      const local = async () => {
        const base = await localLlm.matchAnswers(self, qs, runId, locale);
        return qs.map((_, i) => base[i] ?? base[base.length - 1] ?? "…");
      };
      const { value, meta } = await runPartDetailed<string[]>(
        {
          ...partOpts<string[]>(id, "answers", label),
          validate: (v) => assertStrings(v, qs.length, "answers"),
          fallback: async () => ({ value: await local(), trace: localTrace }),
        },
        () => pick(() => llm.matchAnswers(self, qs, runId, locale), local),
      );
      if (meta.fallback) degraded = true;
      return value;
    };

    // ---- 第一輪：我的隊長提問，對方隊長回答 ----
    await appendEvent(runId, {
      type: "phase",
      text: fill(c.phaseInterview, { name: other.name }),
    });
    const qs1 = await askPart(`q:${runId}:A`, "我的隊長提問", pubMe, pubOther);
    const ans1 = await answerPart(`a:${runId}:B`, "對方隊長作答", pubOther, qs1);
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
    const qs2 = await askPart(`q:${runId}:B`, "對方隊長提問", pubOther, pubMe);
    const ans2 = await answerPart(`a:${runId}:A`, "我的隊長作答", pubMe, qs2);
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

    const reportPart = async (
      side: "A" | "B",
      label: string,
      self: PublicProfile,
      them: PublicProfile,
    ): Promise<MatchReport> => {
      const pairKey = `${runId}:${side}`;
      const local = () => localLlm.matchReport(self, them, qaText, pairKey, runId, locale);
      const { value, meta } = await runPartDetailed<MatchReport>(
        {
          ...partOpts<MatchReport>(`r:${runId}:${side}`, "report", label),
          validate: assertReport,
          fallback: async () => {
            const v = await local();
            return { value: v, trace: reportTrace(v) };
          },
        },
        async () => {
          // real 模式的報告也走 LLM：本場已降級就直接用本機規則（hybrid 的決策層自有退路）
          if (degraded && LLM_MODE === "real") {
            const v = await local();
            return { value: v, trace: { ...reportTrace(v), fallback: true, note: degradedTrace.note } };
          }
          const v = await llm.matchReport(self, them, qaText, pairKey, runId, locale);
          return { value: v, trace: reportTrace(v) };
        },
      );
      if (meta.fallback) degraded = true;
      return {
        ...value,
        usage: {
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
          calls: meta.calls,
        },
      };
    };

    await appendEvent(runId, { type: "phase", text: c.phaseReport });
    const reportA = await reportPart("A", "我的隊長評估", pubMe, pubOther);
    await appendEvent(runId, { type: "report", side: "A", report: reportA });
    await pace();

    const reportB = await reportPart("B", "對方隊長評估", pubOther, pubMe);
    await appendEvent(runId, { type: "report", side: "B", report: reportB });

    // 雙方門檻（pairGate 單一來源）：兩位隊長都 ≥ 60 才算共識
    const bothYes = bothPass({
      userAId: me.userId,
      userBId: other.userId,
      reportA,
      reportB,
    });

    await prisma.matchRun.update({
      where: { id: runId },
      data: {
        status: "completed",
        reportA: reportA as unknown as object,
        reportB: reportB as unknown as object,
      },
    });
    // 已經 completed：收尾事件失敗只記 log，不能把完成的 run 改成 failed
    try {
      await appendEvent(runId, {
        type: "done",
        matchId: null,
        text: bothYes ? c.doneYes : c.doneNo,
      });
    } catch (e) {
      console.error("runPair done event failed", e);
    }
    publish(`user:${me.userId}`, { type: "refresh" });
    publish(`user:${other.userId}`, { type: "refresh" });
  } catch (err) {
    console.error("runPair failed", err);
    await prisma.matchRun
      .update({ where: { id: runId }, data: { status: "failed" } })
      .catch((e) => console.error("runPair failed-status write failed", e));
    await appendEvent(runId, {
      type: "done",
      text: c.doneError,
    }).catch(() => {});
    publish(`user:${me.userId}`, { type: "refresh" });
    if (otherUserId) publish(`user:${otherUserId}`, { type: "refresh" });
  }
}
