import type { GithubVerification } from "./github";

// ---------- 選手檔案（HackathonProfile） ----------
export interface HackathonProfile {
  /** GitHub 技能驗證（由伺服器從 AgentProfile.verification 注入，非使用者編輯） */
  github?: GithubVerification;
  nickname: string;
  role: string; // 主要角色：前端/後端/全端/設計/PM/資料/AI
  skills: string[]; // 技術棧
  timezone: string;
  availability: string; // 投入程度
  goal: string; // 想拿獎/學習/認識人
  workingStyle: string; // 先架構再動手 / 邊做邊改
  vibe: string;
  dealbreakers: string[];
  bio: string;
}

export type VisibilityMap = Record<string, boolean>;

export const HACK_VISIBILITY: VisibilityMap = {
  role: true,
  skills: true,
  timezone: true,
  availability: true,
  goal: true,
  workingStyle: true,
  dealbreakers: false, // 合作地雷預設不對外，僅供己方隊長判斷
};

export const HACK_VISIBILITY_FIELDS = [
  "role",
  "skills",
  "timezone",
  "availability",
  "goal",
  "workingStyle",
  "dealbreakers",
] as const;

// ---------- 互盤報告（5 維度固定） ----------
export interface Dimension {
  values: number; // 目標一致
  lifestyle: number; // 投入程度
  interests: number; // 技能互補
  communication: number; // 協作風格
  intent: number; // 靠譜度
}

export interface MatchReport {
  score: number; // 0-100 總分
  decisionSource?: "jev" | "llm" | "mock"; // 評分由哪一層決策產生（透明可稽核）
  decisionModel?: string;
  ruleScore?: number; // 同一組合的規則層分數（用來對照 Jev 的差別）
  verdict: "recommend" | "cautious" | "pass";
  dimensions: Dimension;
  reasons: string[];
  redFlags: string[];
  sharedTopics: string[];
  summaryForUser: string;
}

// ---------- 隊伍提案報告 ----------
export interface TeamReport {
  score: number;
  rationale: string[];
  coverage: string[];
  risks: string[];
  signals?: {
    mode: "social" | "competence";
    teamEval: number; // 隔離評估原始分
    competenceAvg: number; // 成員帳本平均能力分
  };
}

// ---------- 破冰卡（破冰雷達上每位對象一張） ----------
export interface IcebreakerCard {
  shared: string[]; // 共同點
  complement: string[]; // 互補點
  risk: string; // 風險轉譯
  openers: string[]; // 開場三句
}

// ---------- 隊長對談事件流 ----------
export type RunEventBase =
  | { type: "phase"; text: string }
  | { type: "question"; side: "A" | "B"; text: string }
  | { type: "answer"; side: "A" | "B"; text: string }
  | { type: "report"; side: "A" | "B"; report: MatchReport }
  | { type: "done"; text: string; matchId?: string | null };

export type RunEvent = RunEventBase & { ts: number };

export const HACK_CANDIDATE_THRESHOLD = 60; // 進隊伍提案與破冰雷達的門檻
