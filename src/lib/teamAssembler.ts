import { prisma } from "./db";
import { CONTENT } from "./content";
import type { Locale } from "./i18n-dict";
import {
  HACK_CANDIDATE_THRESHOLD,
  type HackathonProfile,
  type MatchReport,
  type TeamReport,
} from "./types";
import { roleKey } from "./llm/mock";
import {
  decide,
  scoreOf,
  num,
  type DecideAnswer,
  type DecideQuestion,
} from "./llm/decide";
import { runPart } from "./swarm";
import { summarizeLedger } from "./ledger";

/**
 * P1：隊伍組裝改為蜂群式 —
 *   ① Planner（程式）決定性枚舉所有三人假設（≤15 組），每組有穩定 ID
 *   ② 每組假設由獨立評估 part 評分（Jev 優先 / LLM / 規則 fallback）
 *   ③ Merge（程式）：只要 slot 分數，硬約束過濾 + 排序 + 不重疊貪婪挑選
 * 沒有一個「中央 LLM」在閱讀所有報告後做決定。
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

interface Candidate {
  userId: string;
  name: string;
  emoji: string;
  profile: HackathonProfile;
  score: number;
}

interface Hypothesis {
  id: string;
  a: Candidate;
  b: Candidate;
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
  my: HackathonProfile,
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

const pct5 = (v: number) => Math.round((v / 5) * 100);

/** 程序匯合：只讀 slot 分數，模板組裝理由 */
function composeTeamReport(
  locale: Locale,
  my: HackathonProfile,
  hyp: Hypothesis,
  answers: DecideAnswer[],
  source: string,
): TeamReport {
  const c = CONTENT[locale].asm;
  const fill = (tpl: string, vars: Record<string, string | number>) =>
    tpl.replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
    );

  const overall = Math.max(
    0,
    Math.min(100, Math.round((scoreOf(answers, "s_overall", 6) / 9) * 100)),
  );
  const coveragePct = pct5(scoreOf(answers, "s_coverage", 3));
  const complementPct = pct5(scoreOf(answers, "s_complement", 3));
  const chemistryPct = pct5(scoreOf(answers, "s_chemistry", 3));
  const logisticsPct = pct5(scoreOf(answers, "s_logistics", 3));
  const roleGap = num(answers, "n_role_gap", 0.1) >= 0.6;
  const deadlock = num(answers, "n_deadlock", 0.1) >= 0.6;

  const groups = new Set([
    group(my.role),
    group(hyp.a.profile.role),
    group(hyp.b.profile.role),
  ]);
  const allFull = [my, hyp.a.profile, hyp.b.profile].every((p) =>
    isFullTime(p.availability),
  );
  const goals = new Set([my.goal, hyp.a.profile.goal, hyp.b.profile.goal]);

  const roleCount = (["engineering", "design", "product", "data"] as const)
    .map((g) => {
      const n = [my, hyp.a.profile, hyp.b.profile].filter(
        (p) => group(p.role) === g,
      ).length;
      return n > 0 ? `${c.groups[g]} ×${n}` : null;
    })
    .filter(Boolean) as string[];

  const rationale = [
    fill(c.rationaleSkill, {
      a: my.role,
      b: hyp.a.profile.role,
      c: hyp.b.profile.role,
    }),
    allFull ? c.rationaleFull : c.rationaleMixed,
    goals.size === 1
      ? fill(c.rationaleSame, { goal: [...goals][0] })
      : fill(c.rationaleMixed, {}),
    `覆蓋 ${coveragePct} · 互補 ${complementPct} · 化學 ${chemistryPct} · 後勤 ${logisticsPct}（${source.toUpperCase()}）`,
  ];

  const risks: string[] = [];
  if (roleGap) risks.push(c.riskOverlap);
  if (!allFull || logisticsPct < 55) risks.push(c.riskPartTime);
  if (deadlock) risks.push(c.riskOverlap);
  if (risks.length === 0) risks.push(c.riskNone);

  return { score: overall, rationale, coverage: roleCount, risks };
}

async function evaluateHypothesis(
  locale: Locale,
  my: HackathonProfile,
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
            me: {
              role: my.role,
              skills: my.skills,
              goal: my.goal,
              availability: my.availability,
              working_style: my.workingStyle,
            },
            teammate_a: {
              role: hyp.a.profile.role,
              skills: hyp.a.profile.skills,
              goal: hyp.a.profile.goal,
              availability: hyp.a.profile.availability,
              working_style: hyp.a.profile.workingStyle,
            },
            teammate_b: {
              role: hyp.b.profile.role,
              skills: hyp.b.profile.skills,
              goal: hyp.b.profile.goal,
              availability: hyp.b.profile.availability,
              working_style: hyp.b.profile.workingStyle,
            },
          },
          questions: teamQuestions(),
          fallback: (q) => local.find((x) => x.id === q.id) ?? local[0],
        });
        const answers =
          res.source === "mock"
            ? local
            : res.answers.map((a, i) => a ?? local[i]);
        return {
          value: { answers, source: res.source, retained: true },
          trace: {
            provider: res.source,
            model: res.model,
            inputTokens: res.inputTokens,
            answers,
            retained: true,
            confidence:
              answers.filter((a) => a.type === "score").length > 0
                ? Math.min(
                    ...answers
                      .filter((a): a is Extract<DecideAnswer, { type: "score" }> => a.type === "score")
                      .map((a) => a.confidence || 1),
                  )
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
  const myProfile = me.profile.compiled as unknown as HackathonProfile;
  if (!myProfile?.role) throw new Error("PROFILE_NOT_READY");

  const runs = await prisma.matchRun.findMany({
    where: {
      status: "completed",
      OR: [{ userAId: userId }, { userBId: userId }],
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

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const r of runs) {
    const isA = r.userAId === userId;
    const otherId = isA ? r.userBId : r.userAId;
    if (otherId === userId || seen.has(otherId) || pairedWith.has(otherId)) continue;
    const report = (isA ? r.reportA : r.reportB) as MatchReport | null;
    if (!report || report.score < HACK_CANDIDATE_THRESHOLD) continue;
    seen.add(otherId);
    const row = await prisma.user.findUnique({
      where: { id: otherId },
      include: { profile: true },
    });
    const prof = row?.profile?.compiled as unknown as HackathonProfile | null;
    if (!row || !prof?.role) continue;
    candidates.push({
      userId: otherId,
      name: row.name,
      emoji: row.emoji,
      profile: prof,
      score: report.score,
    });
  }

  if (candidates.length < 2) return [];

  candidates.sort((x, y) => y.score - x.score);
  const pool = candidates.slice(0, 6);

  // ---- ① Planner：決定性枚舉所有三人假設（≤15 組），穩定 ID ----
  const hypotheses: Hypothesis[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      hypotheses.push({
        id: `t:${userId}:${pool[i].userId}:${pool[j].userId}`,
        a: pool[i],
        b: pool[j],
      });
    }
  }

  // ---- ② 隔離評估：每組假設一個 part（併發 5） ----
  const results = new Map<
    string,
    { answers: DecideAnswer[]; source: string; retained: boolean }
  >();
  await inPool(hypotheses, 3, async (hyp) => {
    const r = await evaluateHypothesis(locale, myProfile, hyp, userId);
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

  const scored = hypotheses
    .map((hyp) => {
      const r = results.get(hyp.id);
      if (!r) return null;
      const report = composeTeamReport(locale, myProfile, hyp, r.answers, r.source);
      const roleGap = num(r.answers, "n_role_gap", 0) >= 0.6;
      const deadlock = num(r.answers, "n_deadlock", 0) >= 0.6;
      if (report.score < 60 || roleGap || deadlock) return null;

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
      if (signalMode === "competence")
        report.rationale.push(
          `能力模式：互盤 ${raw} × 0.75 ＋ 帳本 ${compAvg} × 0.25 = ${blended}`,
        );
      else
        report.rationale.push(`社交模式：僅採用互盤評估分 ${raw}（對照組）`);
      return { hyp, report };
    })
    .filter(Boolean) as { hyp: Hypothesis; report: TeamReport }[];

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

  const membership = await prisma.eventMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: "desc" },
  });

  const teamIds: string[] = [];
  for (const { hyp, report } of picked) {
    const team = await prisma.team.create({
      data: {
        eventId: membership?.eventId ?? null,
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
