import { prisma } from "./db";
import { CONTENT, roleDisplay } from "./content";
import type { Locale } from "./i18n-dict";
import type { TeamReport, VisibilityMap } from "./types";
import { roleKey } from "./llm/mock";
import {
  decide,
  scoreOf,
  num,
  type DecideAnswer,
  type DecideQuestion,
  type DecideResult,
} from "./llm/decide";
import { LLM_MODE } from "./llm";
import { runPart } from "./swarm";
import { summarizeLedger } from "./ledger";
import { bothPass, latestRunPerPeer, pairScores } from "./pairGate";
import {
  isRedacted,
  publicProfile,
  sanitizeProfile,
  type PublicProfile,
} from "./profile";

/**
 * P1：隊伍組裝改為蜂群式 —
 *   ① Planner（程式）決定性枚舉所有三人假設（≤15 組），ID 由排序後的成員 id 組成（穩定）
 *   ② 每組假設由獨立評估 part 評分（Jev 優先 / LLM / 規則 fallback）
 *   ③ Merge（程式）：只要 slot 分數，硬約束過濾 + 排序 + 不重疊貪婪挑選
 * 沒有一個「中央 LLM」在閱讀所有報告後做決定。
 *
 * 候選：每位對象只看「最新一筆」完成的互盤，而且雙方隊長都 ≥ 60（pairGate.bothPass）。
 * 分享權限：隊友與自己的檔案一律先經 publicProfile 投影，才進 Jev state、理由文字與 TeamMember.role。
 */

const ROLE_GROUP: Record<string, string> = {
  frontend: "engineering",
  backend: "engineering",
  fullstack: "engineering",
  design: "design",
  pm: "product",
  data: "data",
  ai: "data",
  other: "other",
};

const group = (role: string) => ROLE_GROUP[roleKey(role)] ?? "other";
const isFullTime = (a: string) => /全程|Full-time|フル参加|full/i.test(a);

const DIM_LEVELS = ["None", "Weak", "Below average", "Average", "Good", "Excellent"];

export interface Candidate {
  userId: string;
  name: string;
  emoji: string;
  /** 已投影的公開檔案 */
  profile: PublicProfile;
  /** 雙方隊長分數中較低者（pairScores.min） */
  score: number;
}

export interface Hypothesis {
  id: string;
  a: Candidate;
  b: Candidate;
}

/** 穩定假設 ID：以排序後的兩位隊友 id 組成（分數順序變了也不會產生反向重複） */
export function hypothesisId(ownerId: string, x: string, y: string): string {
  const [p, q] = x < y ? [x, y] : [y, x];
  return `t:${ownerId}:${p}:${q}`;
}

/** Planner：枚舉 pool 內所有兩兩組合（≤ C(6,2)=15），a/b 依 id 排序 */
export function enumerateHypotheses(ownerId: string, pool: Candidate[]): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (let i = 0; i < pool.length; i++)
    for (let j = i + 1; j < pool.length; j++) {
      const [a, b] = pool[i].userId < pool[j].userId ? [pool[i], pool[j]] : [pool[j], pool[i]];
      out.push({ id: hypothesisId(ownerId, a.userId, b.userId), a, b });
    }
  return out;
}

/** 硬約束：隊伍評估分 ≥ 60、沒有角色缺口、沒有死鎖 */
export const TEAM_SCORE_FLOOR = 60;
export function passesHardConstraints(evalScore: number, answers: DecideAnswer[]): boolean {
  const roleGap = num(answers, "n_role_gap", 0) >= 0.6;
  const deadlock = num(answers, "n_deadlock", 0) >= 0.6;
  return evalScore >= TEAM_SCORE_FLOOR && !roleGap && !deadlock;
}

/** 隊伍評估原始分：s_overall（0–9 十級）→ 0–100 */
export function teamEvalScore(answers: DecideAnswer[]): number {
  return Math.max(0, Math.min(100, Math.round((scoreOf(answers, "s_overall", 6) / 9) * 100)));
}

/** 能力模式把帳本分混進來；社交模式只用評估分 */
export function blendTeamScore(
  raw: number,
  compAvg: number,
  signalMode: "social" | "competence",
): number {
  return signalMode === "competence" ? Math.round(raw * 0.75 + compAvg * 0.25) : raw;
}

/** 不重疊貪婪：分數高者優先，成員（兩位隊友）不得重複，最多 3 隊（不改動傳入的陣列） */
export function pickNonOverlapping<
  S extends { hyp: { a: { userId: string }; b: { userId: string } }; report: { score: number } },
>(candidates: S[]): S[] {
  const scored = [...candidates];
  scored.sort((x, y) => y.report.score - x.report.score);

  const picked: typeof scored = [];
  const used = new Set<string>();
  for (const s of scored) {
    if (picked.length >= 3) break;
    if (used.has(s.hyp.a.userId) || used.has(s.hyp.b.userId)) continue;
    picked.push(s);
    used.add(s.hyp.a.userId);
    used.add(s.hyp.b.userId);
  }
  return picked;
}

/**
 * team_eval 的 RETAIN 量測：決策值是否原樣進入隊伍報告。
 * 0–9／0–5 換算若被夾限、或遠端層有題目逐題退回規則，就算不保留。
 */
export function measureTeamRetention(
  answers: DecideAnswer[],
  decision: Pick<DecideResult, "source" | "fallbackIds">,
): { retained: boolean; clamped: string[]; overridden: string[] } {
  const clamped: string[] = [];
  const overallRaw = Math.round((scoreOf(answers, "s_overall", 6) / 9) * 100);
  if (overallRaw !== teamEvalScore(answers)) clamped.push("s_overall");
  for (const id of ["s_coverage", "s_complement", "s_chemistry", "s_logistics"]) {
    const v = pct5(scoreOf(answers, id, 3));
    if (v < 0 || v > 100) clamped.push(id);
  }
  const overridden = decision.source === "mock" ? [] : [...decision.fallbackIds];
  return { retained: clamped.length === 0 && overridden.length === 0, clamped, overridden };
}

function teamQuestions(): DecideQuestion[] {
  return [
    {
      id: "s_coverage",
      type: "score",
      instructions:
        "How well do the three roles cover the skills a hackathon team needs? Three distinct role groups (engineering / design / product / data) is ideal; duplicated roles with gaps is bad.",
      criteria: DIM_LEVELS,
    },
    {
      id: "s_complement",
      type: "score",
      instructions:
        "How complementary are the three people's skills? Different stacks and roles that cover each other rank high; identical stacks rank low.",
      criteria: DIM_LEVELS,
    },
    {
      id: "s_chemistry",
      type: "score",
      instructions:
        "How likely are these three to collaborate well under time pressure, based on their stated working styles and goals?",
      criteria: DIM_LEVELS,
    },
    {
      id: "s_logistics",
      type: "score",
      instructions:
        "How well does their availability line up for a 48-hour hackathon?",
      criteria: DIM_LEVELS,
    },
    {
      id: "n_role_gap",
      type: "noul",
      instructions:
        "Two or more members share the same role group while another needed role group is missing entirely.",
    },
    {
      id: "n_deadlock",
      type: "noul",
      instructions:
        "Their stated dealbreakers or working styles clearly clash in a way that would deadlock a three-person team.",
    },
    {
      id: "s_overall",
      type: "score",
      instructions:
        "Overall quality of this three-person squad for the hackathon, from the lowest band (avoid) to the highest band (dream squad).",
      criteria: [
        "0-10 (avoid)",
        "11-20",
        "21-30",
        "31-40",
        "41-50",
        "51-60",
        "61-70",
        "71-80",
        "81-90",
        "91-100 (dream squad)",
      ],
    },
  ];
}

/** 規則層答案（fallback 與 mock provider）：以既有啟發式為底，保證行為一致 */
export function localTeamAnswers(
  my: PublicProfile,
  hyp: Hypothesis,
): DecideAnswer[] {
  const a = hyp.a.profile;
  const b = hyp.b.profile;
  const groups = new Set([group(my.role), group(a.role), group(b.role)]);
  const allFull = [my, a, b].every((p) => isFullTime(p.availability));
  const goals = new Set([my.goal, a.goal, b.goal]);
  const sameRolePenalty = group(a.role) === group(b.role) ? -4 : 0;
  const roleBonus = groups.size >= 3 ? 7 : groups.size === 2 ? 3 : -5;
  const base = (hyp.a.score + hyp.b.score) / 2;
  const overall = Math.max(
    40,
    Math.min(96, Math.round(base + roleBonus + (allFull ? 4 : -3) + (goals.size === 1 ? 4 : 1) + sameRolePenalty)),
  );

  const cov = groups.size >= 3 ? 5 : groups.size === 2 ? 3.4 : 1.4;
  return [
    { id: "s_coverage", type: "score", value: cov, confidence: 1, probabilities: {} },
    {
      id: "s_complement",
      type: "score",
      value: group(a.role) !== group(b.role) ? 4.2 : 2.4,
      confidence: 1,
      probabilities: {},
    },
    {
      id: "s_chemistry",
      type: "score",
      value: goals.size === 1 ? 4.4 : 3,
      confidence: 1,
      probabilities: {},
    },
    {
      id: "s_logistics",
      type: "score",
      value: allFull ? 4.8 : 2.4,
      confidence: 1,
      probabilities: {},
    },
    { id: "n_role_gap", type: "noul", value: groups.size === 1 ? 0.85 : 0.1 },
    { id: "n_deadlock", type: "noul", value: 0.15 },
    {
      id: "s_overall",
      type: "score",
      value: Math.round((overall / 100) * 9 * 10) / 10, // 0..9 十級
      confidence: 1,
      probabilities: {},
    },
  ];
}

function pct5(v: number) {
  return Math.round((v / 5) * 100);
}

/** 程序匯合：只讀 slot 分數，模板組裝理由（四語系） */
export function composeTeamReport(
  locale: Locale,
  my: PublicProfile,
  hyp: Hypothesis,
  answers: DecideAnswer[],
  source: string,
): TeamReport {
  const content = CONTENT[locale] ?? CONTENT.zh;
  const c = content.asm;
  const fill = (tpl: string, vars: Record<string, string | number>) =>
    tpl.replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
    );
  const shown = (v: string) => (isRedacted(v) ? c.hidden : v);
  const roleName = (role: string) => (isRedacted(role) ? c.hidden : roleDisplay(locale, role));

  const overall = teamEvalScore(answers);
  const coveragePct = pct5(scoreOf(answers, "s_coverage", 3));
  const complementPct = pct5(scoreOf(answers, "s_complement", 3));
  const chemistryPct = pct5(scoreOf(answers, "s_chemistry", 3));
  const logisticsPct = pct5(scoreOf(answers, "s_logistics", 3));
  const roleGap = num(answers, "n_role_gap", 0.1) >= 0.6;
  const deadlock = num(answers, "n_deadlock", 0.1) >= 0.6;

  const members = [my, hyp.a.profile, hyp.b.profile];
  const allFull = members.every((p) => isFullTime(p.availability));
  const goals = new Set(members.map((p) => shown(p.goal)));

  const roleCount = (["engineering", "design", "product", "data"] as const)
    .map((g) => {
      const n = members.filter((p) => group(p.role) === g).length;
      return n > 0 ? `${c.groups[g]} ×${n}` : null;
    })
    .filter(Boolean) as string[];

  const rationale = [
    fill(c.rationaleSkill, {
      a: roleName(my.role),
      b: roleName(hyp.a.profile.role),
      c: roleName(hyp.b.profile.role),
    }),
    allFull ? c.rationaleFull : c.rationaleMixed,
    goals.size === 1
      ? fill(c.rationaleSame, { goal: [...goals][0] })
      : fill(c.rationaleGoalsMixed, { goals: [...goals].join(content.listSep) }),
    fill(c.rationaleEvidence, {
      coverage: coveragePct,
      complement: complementPct,
      chemistry: chemistryPct,
      logistics: logisticsPct,
      source: source.toUpperCase(),
    }),
  ];

  const risks: string[] = [];
  if (roleGap) risks.push(c.riskOverlap);
  if (!allFull || logisticsPct < 55) risks.push(c.riskPartTime);
  if (deadlock) risks.push(c.riskDeadlock);
  if (risks.length === 0) risks.push(c.riskNone);

  return { score: overall, rationale, coverage: roleCount, risks };
}

/** 送進決策層的隊伍 state：只放投影後、正規化的結構化欄位 */
function memberState(p: PublicProfile) {
  return {
    role: p.role,
    skills: p.skills,
    goal: p.goal,
    availability: p.availability,
    working_style: p.workingStyle,
  };
}

async function evaluateHypothesis(
  my: PublicProfile,
  hyp: Hypothesis,
  ownerId: string,
): Promise<{ answers: DecideAnswer[]; source: string; retained: boolean } | null> {
  const local = localTeamAnswers(my, hyp);
  try {
    return await runPart(
      {
        id: hyp.id,
        kind: "team_eval",
        label: `${hyp.a.name}+${hyp.b.name}`,
        teamId: `h:${ownerId}`,
      },
      async () => {
        const res = await decide({
          state: {
            me: memberState(my),
            teammate_a: memberState(hyp.a.profile),
            teammate_b: memberState(hyp.b.profile),
          },
          questions: teamQuestions(),
          fallback: (q) => local.find((x) => x.id === q.id) ?? local[0],
          // LLM_PROVIDER=mock（或沒有 LLM key）＝整個引擎離線：組隊評估也不外送
          provider: LLM_MODE === "mock" ? "mock" : undefined,
          sessionId: `team:${ownerId}`,
        });
        const answers = res.answers;
        const retention = measureTeamRetention(answers, res);
        const scores = answers.filter(
          (a): a is Extract<DecideAnswer, { type: "score" }> => a.type === "score",
        );
        return {
          value: { answers, source: res.source, retained: retention.retained },
          trace: {
            provider: res.source,
            model: res.model,
            inputTokens: res.inputTokens,
            outputTokens: res.outputTokens,
            answers,
            retained: retention.retained,
            confidence:
              scores.length > 0
                ? Math.min(...scores.map((a) => a.confidence || 1))
                : undefined,
          },
        };
      },
    );
  } catch {
    return null; // part 級重試後仍失敗 → 該假設不進入匯合（覆蓋率會如實反映）
  }
}

async function inPool<T>(items: T[], limit: number, fn: (t: T) => Promise<unknown>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * 蜂群式組裝：回傳建立的 Team ids（≤3，成員不重複）
 */
export async function assembleTeams(
  userId: string,
  locale: Locale = "zh",
): Promise<string[]> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });
  if (!me?.profile?.compiled) throw new Error("PROFILE_NOT_READY");
  const myRaw = sanitizeProfile(me.profile.compiled);
  if (!myRaw.role) throw new Error("PROFILE_NOT_READY");
  // 理由文字給全隊看、state 送決策層 → 自己也用投影
  const myProfile = publicProfile(myRaw, (me.profile.visibility as VisibilityMap) ?? null);

  const membership = await prisma.eventMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "desc" },
  });
  const eventId = membership?.eventId ?? null;

  const runs = await prisma.matchRun.findMany({
    where: {
      status: "completed",
      OR: [{ userAId: userId }, { userBId: userId }],
      ...(eventId ? { eventId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  const existingTeams = await prisma.teamMember.findMany({
    where: { userId },
    include: { team: { include: { members: true } } },
  });
  const pairedWith = new Set<string>();
  for (const tm of existingTeams) {
    if (tm.team.status !== "assembled") continue;
    for (const m of tm.team.members) {
      if (m.userId !== userId) pairedWith.add(m.userId);
    }
  }

  // 每位對象只看最新一筆 run；雙方隊長都 ≥ 60 才進候選
  const latest = latestRunPerPeer(runs, userId);
  const eligible = [...latest.entries()].filter(
    ([otherId, r]) => !pairedWith.has(otherId) && bothPass(r),
  );
  const rows = await prisma.user.findMany({
    where: { id: { in: eligible.map(([id]) => id) } },
    include: { profile: true },
  });
  const rowMap = new Map(rows.map((r) => [r.id, r]));

  const candidates: Candidate[] = [];
  for (const [otherId, r] of eligible) {
    const row = rowMap.get(otherId);
    if (!row?.profile?.compiled) continue;
    const raw = sanitizeProfile(row.profile.compiled);
    if (!raw.role) continue;
    candidates.push({
      userId: otherId,
      name: row.name,
      emoji: row.emoji,
      profile: publicProfile(raw, (row.profile.visibility as VisibilityMap) ?? null),
      score: pairScores(r, userId).min ?? 0,
    });
  }

  if (candidates.length < 2) return [];

  candidates.sort((x, y) => y.score - x.score || (x.userId < y.userId ? -1 : 1));
  const pool = candidates.slice(0, 6);

  // ---- ① Planner：決定性枚舉所有三人假設（≤15 組），穩定 ID ----
  const hypotheses = enumerateHypotheses(userId, pool);

  // 上一輪的假設移到封存 teamId：HYPOTHESES 統計與網絡模擬只看最新一輪
  // （本輪 runPart 會用相同的穩定 ID 把重複的假設搬回 h:<userId>）
  await prisma.swarmPart.updateMany({
    where: { teamId: `h:${userId}`, kind: "team_eval" },
    data: { teamId: `h:${userId}:prev` },
  });

  // ---- ② 隔離評估：每組假設一個 part（併發 3） ----
  const results = new Map<
    string,
    { answers: DecideAnswer[]; source: string; retained: boolean }
  >();
  await inPool(hypotheses, 3, async (hyp) => {
    const r = await evaluateHypothesis(myProfile, hyp, userId);
    if (r) results.set(hyp.id, r);
  });

  // ---- ③ 匯合（程式）：只讀 slot、硬約束過濾、不重疊貪婪 ----
  // ---- P2：代理帳本（能力分）＋ ASSEMBLY_SIGNAL 模式 ----
  const signalMode =
    process.env.ASSEMBLY_SIGNAL === "social" ? "social" : "competence";
  const memberIds = Array.from(
    new Set(hypotheses.flatMap((h) => [h.a.userId, h.b.userId])),
  );
  const ledger = await summarizeLedger(memberIds);
  const asm = (CONTENT[locale] ?? CONTENT.zh).asm;
  const fillT = (tpl: string, vars: Record<string, string | number>) =>
    tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));

  const scored = hypotheses
    .map((hyp) => {
      const r = results.get(hyp.id);
      if (!r) return null;
      const report = composeTeamReport(locale, myProfile, hyp, r.answers, r.source);
      if (!passesHardConstraints(report.score, r.answers)) return null;

      const raw = report.score;
      const compAvg = Math.round(
        ((ledger.get(hyp.a.userId)?.score ?? 35) +
          (ledger.get(hyp.b.userId)?.score ?? 35)) /
          2,
      );
      const blended =
        signalMode === "competence"
          ? Math.round(raw * 0.75 + compAvg * 0.25)
          : raw;
      report.score = blended;
      report.signals = {
        mode: signalMode,
        teamEval: raw,
        competenceAvg: compAvg,
      };
      report.rationale.push(
        signalMode === "competence"
          ? fillT(asm.rationaleCompetence, { raw, comp: compAvg, blended })
          : fillT(asm.rationaleSocial, { raw }),
      );
      return { hyp, report };
    })
    .filter(Boolean) as { hyp: Hypothesis; report: TeamReport }[];

  const picked = pickNonOverlapping(scored);

  const teamIds: string[] = [];
  for (const { hyp, report } of picked) {
    const team = await prisma.team.create({
      data: {
        eventId,
        status: "proposed",
        score: report.score,
        report: report as unknown as object,
        members: {
          create: [
            { userId, role: myProfile.role, accepted: false },
            { userId: hyp.a.userId, role: hyp.a.profile.role, accepted: false },
            { userId: hyp.b.userId, role: hyp.b.profile.role, accepted: false },
          ],
        },
      },
    });
    teamIds.push(team.id);
  }
  return teamIds;
}
