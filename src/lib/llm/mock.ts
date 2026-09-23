import type {
  HackathonProfile,
  IcebreakerCard,
  MatchReport,
  ReportRetention,
} from "../types";
import type { Locale } from "../i18n-dict";
import { isRedacted, sanitizeProfile, type PublicProfile } from "../profile";
import { CONTENT, canonical } from "../content";
import {
  decide,
  num,
  scoreOf,
  type DecideAnswer,
  type DecideQuestion,
  type DecideResult,
} from "./decide";

// ================= 工具 =================
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function overlap(a: string[], b: string[]): string[] {
  const setB = new Set(b.map((x) => x.trim()));
  return a.filter((x) => setB.has(x.trim()));
}

const clip = (s: string, n = 18) => (s.length > n ? s.slice(0, n) + "…" : s);

function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

const c = (locale: Locale) => CONTENT[locale] ?? CONTENT.zh;

/** 任意語系的角色字串 → canonical 角色鍵（找不到就原樣回傳） */
export function roleKey(role: string): string {
  const hit = CONTENT.zh.roles.find(([re]) => {
    try {
      return new RegExp(re, "i").test(role);
    } catch {
      return false;
    }
  })?.[1];
  return hit ?? role;
}

const ROLE_GROUP: Record<string, string> = {
  frontend: "engineering",
  backend: "engineering",
  fullstack: "engineering",
  design: "design",
  pm: "product",
  data: "data",
  ai: "data",
};

export const roleGroup = (role: string) => ROLE_GROUP[roleKey(role)] ?? "other";

const isFullTime = (locale: Locale, a: string) =>
  canonical("availability", a, locale) === "fulltime";

// ================= Onboarding =================
export async function mockInterviewTurn(
  transcript: { role: "agent" | "user"; content: string }[],
  _sessionId?: string,
  locale: Locale = "zh",
): Promise<{ reply: string; done: boolean }> {
  const p = c(locale);
  const userMsgs = transcript.filter((t) => t.role === "user");
  const last = userMsgs[userMsgs.length - 1]?.content ?? "";
  const answered = userMsgs.length;
  if (answered >= p.interview.length) {
    return { reply: fill(p.closing, { answer: clip(last) }), done: true };
  }
  return {
    reply: `${fill(p.echo, { answer: clip(last) })} ${p.interview[answered]}`,
    done: false,
  };
}

// ================= Profile 編譯 =================
const SKILL_DICT = [
  "React", "Vue", "Next.js", "TypeScript", "JavaScript", "Node",
  "Python", "FastAPI", "Django", "PyTorch", "TensorFlow", "LangChain",
  "RAG", "LLM", "Agent", "Prompt Engineering", "Flutter", "Firebase",
  "Swift", "Kotlin", "Figma", "UI/UX", "Tailwind", "AWS", "GCP", "Azure",
  "Docker", "Kubernetes", "PostgreSQL", "MySQL", "MongoDB", "Redis",
  "Supabase", "Solidity",
];

export async function mockCompileProfile(
  userName: string,
  answers: string[],
  _sessionId?: string,
  locale: Locale = "zh",
): Promise<HackathonProfile> {
  const p = c(locale);
  const all = answers.join(" ");

  const role = roleKey(all) === all ? "fullstack" : roleKey(all);
  const skills = SKILL_DICT.filter((s) =>
    new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(all),
  ).slice(0, 6);

  const availKey = canonical("availability", all, locale);
  const availability =
    availKey === "fulltime"
      ? p.options.availability.full
      : availKey === "parttime"
        ? p.options.availability.part
        : p.options.availability.flex;

  const goalKey = canonical("goal", all, locale) as
    | "win"
    | "learn"
    | "network"
    | "build";
  const goal = p.options.goal[goalKey];

  const styleKey = canonical("style", all, locale);
  const workingStyle =
    styleKey === "architect"
      ? p.options.style.architect
      : styleKey === "iterative"
        ? p.options.style.iterative
        : p.options.style.flex;

  const s0 = skills[0] ?? "TypeScript";
  const vibe = fill(p.vibeTemplate, {
    role: p.roleLabels[role] ?? role,
    topic: s0,
    goal,
  });

  return {
    nickname: userName,
    role,
    skills: skills.length ? skills : ["TypeScript"],
    timezone: "Asia/Taipei",
    availability,
    goal,
    workingStyle,
    vibe,
    dealbreakers: [...p.defaultDealbreakers],
    bio: fill(p.bioTemplate, { vibe }),
  };
}

// ================= 互盤：提問 / 回答 =================
export async function mockMatchQuestions(
  self: HackathonProfile,
  other: PublicProfile,
  _sessionId?: string,
  locale: Locale = "zh",
): Promise<string[]> {
  const p = c(locale);
  const landmine = self.dealbreakers[0] ?? p.defaultDealbreakers[0];
  return p.mq.map((q) => fill(q, { name: other.nickname, landmine }));
}

export async function mockMatchAnswers(
  self: HackathonProfile,
  _questions: string[],
  _sessionId?: string,
  locale: Locale = "zh",
): Promise<string[]> {
  const p = c(locale);
  const verified = self.github
    ? fill(p.reasons.verified, {
        repos: self.github.publicRepos,
        langs:
          self.github.topLanguages
            .slice(0, 2)
            .map((t) => t.lang)
            .join("/") || "—",
      })
    : "";
  return [
    fill(p.ma[0], {
      name: self.nickname,
      role: p.roleLabels[roleKey(self.role)] ?? self.role,
      skills: self.skills.slice(0, 3).join(p.listSep) || "—",
      verified,
    }),
    fill(p.ma[1], {
      name: self.nickname,
      goal: self.goal,
      availability: self.availability,
    }),
    fill(p.ma[2], {
      name: self.nickname,
      style: self.workingStyle,
      landmines: self.dealbreakers.join(p.listSep) || "—",
    }),
  ];
}

// ================= 互盤報告（Jev 決策 → 模板合成） =================
const DIM_LEVELS = [
  "None at all",
  "Very weak",
  "Weak",
  "Below average",
  "Average",
  "Above average",
  "Strong",
  "Very strong",
  "Excellent",
  "Perfect fit",
];

const isArchitect = (style: string) => /架構|架构|Architecture|設計|设计/.test(style);

function reportQuestions(): DecideQuestion[] {
  return [
    { id: "d_skill", type: "score", instructions: "How complementary are the two participants' skills for building a hackathon demo together? Different roles that cover each other should score high; identical roles with no cover should score low.", criteria: DIM_LEVELS },
    { id: "d_goal", type: "score", instructions: "How aligned are the two participants' hackathon goals (win / learn / network / build)?", criteria: DIM_LEVELS },
    { id: "d_avail", type: "score", instructions: "How well does their available time match up (full-time vs evenings/weekends)?", criteria: DIM_LEVELS },
    { id: "d_comms", type: "score", instructions: "How compatible are their ways of working (architecture-first vs build-and-iterate)?", criteria: DIM_LEVELS },
    { id: "d_reliability", type: "score", instructions: "Based on how they describe themselves, how reliable do they seem as teammates?", criteria: DIM_LEVELS },
    { id: "n_goal_diff", type: "noul", instructions: "The two participants' hackathon goals are clearly different from each other." },
    { id: "n_avail_diff", type: "noul", instructions: "Their available time differs a lot (one is full-time, the other part-time only)." },
    { id: "n_role_overlap", type: "noul", instructions: "Their main roles overlap heavily, so they risk duplicating each other's work." },
  ];
}

/**
 * 送進決策層（Jev/LLM）的 state：只放正規化後的結構化值。
 * 呼叫端（matching.runPair、compare）傳入的雙方檔案都已是 publicProfile 投影。
 */
function reportState(
  selfIn: HackathonProfile,
  otherIn: PublicProfile,
  qa?: string,
): Record<string, unknown> {
  const self = sanitizeProfile(selfIn);
  const other = sanitizeProfile(otherIn);
  return {
    me: {
      nickname: self.nickname,
      role: self.role,
      skills: self.skills,
      goal: self.goal,
      availability: self.availability,
      working_style: self.workingStyle,
    },
    them: {
      nickname: other.nickname,
      role: other.role,
      skills: other.skills,
      goal: other.goal,
      availability: other.availability,
      working_style: other.workingStyle,
    },
    interview_excerpt: (qa ?? "").slice(0, 6000),
  };
}

function localReportAnswers(
  self: HackathonProfile,
  other: PublicProfile,
  pairKey: string,
  locale: Locale,
): DecideAnswer[] {
  const jitter = hashStr(pairKey) % 7;
  // 被分享權限遮蔽（未公開）的欄位視為未知：不當成「相同」也不當成「重疊」
  const comp =
    isRedacted(self.role) ||
    isRedacted(other.role) ||
    roleGroup(self.role) !== roleGroup(other.role);
  const sharedSkills = overlap(self.skills, other.skills);
  const fullAvail =
    isFullTime(locale, self.availability) && isFullTime(locale, other.availability);
  const goalMatch =
    !isRedacted(self.goal) && !isRedacted(other.goal) && self.goal === other.goal;
  const styleMatch = isArchitect(self.workingStyle) === isArchitect(other.workingStyle);

  const dim = (v: number): DecideAnswer => ({
    id: "",
    type: "score",
    value: v,
    confidence: 0.5,
    probabilities: {},
  });
  const noul = (v: number): DecideAnswer => ({ id: "", type: "noul", value: v });

  return [
    { ...dim((comp ? 7 : 4.5) + Math.min(1.5, sharedSkills.length * 0.4)), id: "d_skill" },
    { ...dim(goalMatch ? 8 : 4.5), id: "d_goal" },
    { ...dim(fullAvail ? 8 : 5), id: "d_avail" },
    { ...dim(styleMatch ? 7.5 : 4.5), id: "d_comms" },
    { ...dim(6.5 + (jitter % 3) * 0.5), id: "d_reliability" },
    { ...noul(goalMatch ? 0.1 : 0.9), id: "n_goal_diff" },
    { ...noul(fullAvail ? 0.1 : 0.85), id: "n_avail_diff" },
    { ...noul(comp ? 0.1 : 0.85), id: "n_role_overlap" },
  ];
}

/** 決策分數（0-9）→ 0-100（未夾限的線性換算） */
const scale100 = (v: number) => Math.round((v / 9) * 100);
/** 決策分數（0-9）→ 0-100，夾在 25–97（夾限會讓決策值失真 → RETAIN 算不保留） */
const to100 = (v: number) => Math.max(25, Math.min(97, scale100(v)));

const DIM_SLOTS = [
  ["interests", "d_skill", 5],
  ["values", "d_goal", 5],
  ["lifestyle", "d_avail", 5],
  ["communication", "d_comms", 5],
  ["intent", "d_reliability", 6],
] as const;

const ROLE_OVERLAP_RULE = (self: HackathonProfile, other: PublicProfile) =>
  !isRedacted(self.role) &&
  !isRedacted(other.role) &&
  roleGroup(self.role) === roleGroup(other.role);

/**
 * RETAIN 量測（純函式）：決策層給的 slot 值是否「原封不動」進入最終報告。
 *   - 維度：0-9 → 0-100 的換算若被 25–97 夾限改寫 → clamped
 *   - 旗標：規則以 OR 覆寫決策層的判斷（例如 n_role_overlap）→ overridden
 *   - 決策層是遠端（jev/llm）但該題逐題退回規則 → overridden
 * 全部 slot 都原樣保留才算 retained。
 */
export function measureReportRetention(
  self: HackathonProfile,
  other: PublicProfile,
  answers: DecideAnswer[],
  decision: { source: DecideResult["source"]; fallbackIds: string[] },
): ReportRetention {
  const clamped: string[] = [];
  const overridden = new Set<string>();
  const has = (id: string) => answers.some((a) => a.id === id);
  for (const [, id, dft] of DIM_SLOTS) {
    if (!has(id)) {
      overridden.add(id); // 缺答 → 用預設值
      continue;
    }
    const v = scoreOf(answers, id, dft);
    if (to100(v) !== scale100(v)) clamped.push(id);
  }
  for (const id of ["n_goal_diff", "n_avail_diff", "n_role_overlap"]) {
    if (!has(id)) overridden.add(id);
  }
  const decidedOverlap = num(answers, "n_role_overlap", 0) >= 0.6;
  if (!decidedOverlap && ROLE_OVERLAP_RULE(self, other)) overridden.add("n_role_overlap");
  if (decision.source !== "mock")
    for (const id of decision.fallbackIds) overridden.add(id);

  const slots = DIM_SLOTS.length + 3;
  const lost = new Set([...clamped, ...overridden]);
  return {
    retained: lost.size === 0,
    slots,
    kept: slots - lost.size,
    clamped,
    overridden: [...overridden],
  };
}

function composeReport(
  self: HackathonProfile,
  other: PublicProfile,
  answers: DecideAnswer[],
  locale: Locale,
): MatchReport {
  const p = c(locale);
  const dims = {
    interests: to100(scoreOf(answers, "d_skill", 5)),
    values: to100(scoreOf(answers, "d_goal", 5)),
    lifestyle: to100(scoreOf(answers, "d_avail", 5)),
    communication: to100(scoreOf(answers, "d_comms", 5)),
    intent: to100(scoreOf(answers, "d_reliability", 6)),
  };
  const score = Math.round(
    (dims.interests + dims.values + dims.lifestyle + dims.communication + dims.intent) / 5,
  );
  const verdict: MatchReport["verdict"] =
    score >= 70 ? "recommend" : score >= 55 ? "cautious" : "pass";

  const goalDiff = num(answers, "n_goal_diff", 0) >= 0.6;
  const availDiff = num(answers, "n_avail_diff", 0) >= 0.6;
  const roleOverlap =
    num(answers, "n_role_overlap", 0) >= 0.6 || ROLE_OVERLAP_RULE(self, other);

  const sharedSkills = overlap(self.skills, other.skills);
  const reasons: string[] = [];
  if (other.github)
    reasons.push(
      fill(p.reasons.verified, {
        repos: other.github.publicRepos,
        langs:
          other.github.topLanguages.slice(0, 2).map((t) => t.lang).join("/") || "—",
      }),
    );
  else if (other.skills?.length) reasons.push(p.reasons.unverified);
  if (dims.interests >= 60 && !roleOverlap)
    reasons.push(
      fill(p.reasons.comp, {
        a: p.roleLabels[roleKey(self.role)] ?? self.role,
        b: p.roleLabels[roleKey(other.role)] ?? other.role,
      }),
    );
  if (sharedSkills.length)
    reasons.push(
      fill(p.reasons.commonTech, { list: sharedSkills.slice(0, 2).join(p.listSep) }),
    );
  if (dims.lifestyle >= 70) reasons.push(p.reasons.fullTime);
  if (!goalDiff && !isRedacted(self.goal) && self.goal)
    reasons.push(fill(p.reasons.goalSame, { goal: self.goal }));
  if (dims.communication >= 70) reasons.push(p.reasons.styleSame);
  if (reasons.length === 0) reasons.push(p.reasons.fallback);

  const redFlags: string[] = [];
  if (roleOverlap)
    redFlags.push(
      fill(p.redFlags.sameRole, {
        role: p.roleLabels[roleKey(self.role)] ?? self.role,
      }),
    );
  if (availDiff || dims.lifestyle < 70) redFlags.push(p.redFlags.availDiff);
  if (goalDiff || dims.values < 70)
    redFlags.push(fill(p.redFlags.goalDiff, { mine: self.goal, theirs: other.goal }));
  if (redFlags.length === 0) redFlags.push(p.redFlags.none);

  const sharedTopics = sharedSkills.length
    ? sharedSkills.slice(0, 4)
    : p.topicsFallback.slice(0, 3);
  const top = sharedTopics[0] ?? "—";
  const summaryForUser =
    verdict === "recommend"
      ? fill(p.summary.recommend, { top, reason: reasons[0] })
      : verdict === "cautious"
        ? fill(p.summary.cautious, { top, reason: reasons[0] })
        : fill(p.summary.pass, { top, reason: reasons[0] });

  return { score, verdict, dimensions: dims, reasons, redFlags, sharedTopics, summaryForUser };
}

/** 決策結果 → 報告（附 RETAIN 量測、逐題退回數、覆蓋明細） */
function reportFromDecision(
  self: HackathonProfile,
  other: PublicProfile,
  result: DecideResult,
  locale: Locale,
): MatchReport {
  return {
    ...composeReport(self, other, result.answers, locale),
    decisionSource: result.source,
    decisionModel: result.model,
    fallbackCount: result.coverage.fallbacks,
    decisionCoverage: {
      expected: result.coverage.expected,
      remote: result.coverage.remote,
      fallbacks: result.coverage.fallbacks,
      retries: result.coverage.retries,
    },
    retention: measureReportRetention(self, other, result.answers, result),
  };
}

/** 規則引擎報告（offline；測試與無 key 環境） */
export async function mockMatchReport(
  self: HackathonProfile,
  other: PublicProfile,
  _qa: string,
  pairKey: string,
  _sessionId?: string,
  locale: Locale = "zh",
): Promise<MatchReport> {
  const local = localReportAnswers(self, other, pairKey, locale);
  const result = await decide({
    state: reportState(self, other, _qa),
    questions: reportQuestions(),
    provider: "mock",
    fallback: (q) => local.find((a) => a.id === q.id) ?? local[0],
  });
  return reportFromDecision(self, other, result, locale);
}

/** Jev 決策報告（env provider；失敗自動退回規則引擎） */
export async function decisionMatchReport(
  self: HackathonProfile,
  other: PublicProfile,
  qa: string,
  pairKey: string,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<MatchReport> {
  const local = localReportAnswers(self, other, pairKey, locale);
  const result = await decide({
    state: reportState(self, other, qa),
    questions: reportQuestions(),
    sessionId,
    fallback: (q) => local.find((a) => a.id === q.id) ?? local[0],
  });
  if (result.source === "mock" && result.note)
    console.warn(`[report] decision fallback → ${result.note}`);
  // 規則層對照分（純函式、零成本）：讓 UI 直接顯示「有 Jev 的差別」
  const ruleReport = composeReport(self, other, local, locale);
  return {
    ...reportFromDecision(self, other, result, locale),
    ruleScore: ruleReport.score,
  };
}

// ================= 破冰卡 =================
export async function mockIcebreakerCard(
  self: HackathonProfile,
  other: PublicProfile,
  _pairKey: string,
  _sessionId?: string,
  locale: Locale = "zh",
): Promise<IcebreakerCard> {
  const p = c(locale);
  const selfLabel = p.roleLabels[roleKey(self.role)] ?? self.role;
  const otherLabel = p.roleLabels[roleKey(other.role)] ?? other.role;
  const shared = overlap(self.skills, other.skills).slice(0, 3);

  const complement =
    roleGroup(self.role) !== roleGroup(other.role)
      ? [
          fill(p.card.complementDiff, {
            a: selfLabel,
            name: other.nickname,
            b: otherLabel,
          }),
        ]
      : [fill(p.card.complementSame, { role: selfLabel })];

  const riskParts: string[] = [];
  if (self.goal !== other.goal)
    riskParts.push(
      fill(p.card.riskGoal, { mine: self.goal, theirs: other.goal }),
    );
  if (
    !isFullTime(locale, self.availability) ||
    !isFullTime(locale, other.availability)
  )
    riskParts.push(p.card.riskAvail);
  const risk = riskParts.length ? riskParts.join("；") : p.card.riskNone;

  const sharedFrag = shared.length
    ? fill(p.reasons.commonTech, { list: shared.slice(0, 2).join(p.listSep) }) +
      "。"
    : "";
  const goalLine = self.goal === other.goal
    ? fill(p.reasons.goalSame, { goal: self.goal }) + "。"
    : "";
  const t0 = shared[0] ?? self.skills[0] ?? "TypeScript";

  return {
    shared,
    complement,
    risk,
    openers: [
      fill(p.card.openers[0], {
        availability: self.availability,
        shared: sharedFrag,
        role: selfLabel,
        goal: self.goal,
        name: self.nickname,
        t0,
        theirGoal: other.goal,
        styleLine: "",
        goalLine,
      }),
      fill(p.card.openers[1], {
        availability: self.availability,
        shared: sharedFrag,
        role: selfLabel,
        goal: self.goal,
        name: other.nickname,
        t0,
        theirGoal: other.goal,
        styleLine: "",
        goalLine,
      }),
      fill(p.card.openers[2], {
        availability: self.availability,
        shared: sharedFrag,
        role: selfLabel,
        goal: self.goal,
        name: other.nickname,
        t0,
        theirGoal: other.goal,
        styleLine: "",
        goalLine,
      }),
    ],
  };
}

// ================= 團隊回話 =================
export async function mockTeamReply(
  bot: HackathonProfile,
  teamHistory: { senderId: string; content: string }[],
  botId: string,
  _sessionId?: string,
  locale: Locale = "zh",
): Promise<string> {
  const p = c(locale);
  const humanCount = teamHistory.filter((m) => m.senderId !== botId).length;
  const openers =
    p.teamOpeners[roleKey(bot.role)] ?? p.teamOpeners.fullstack ?? [];
  if (humanCount <= 1 && openers.length) return openers[0];
  return p.teamFollowups[
    hashStr(bot.nickname + humanCount) % p.teamFollowups.length
  ];
}


// ================= 一對一私訊回話 =================
export async function mockDmReply(
  bot: HackathonProfile,
  history: { senderId: string; content: string }[],
  botId: string,
  _sessionId?: string,
  locale: Locale = "zh",
): Promise<string> {
  const p = c(locale);
  const humanCount = history.filter((h) => h.senderId !== botId).length;
  if (humanCount <= 1) return p.dm[0];
  return p.dm[1 + (hashStr(bot.nickname + humanCount) % (p.dm.length - 1))];
}
