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
  // 合作地雷預設不對外：publicProfile 只有 visibility.dealbreakers === true 才保留。
  // 互盤／組隊／網絡一律只用投影，所以預設下地雷不會進逐字稿、報告、LLM prompt 或 Jev state。
  dealbreakers: false,
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
  /** 決策題中退回本機規則的題數（遠端缺答、格式或範圍不合法、整層失敗） */
  fallbackCount?: number;
  /** 決策層覆蓋明細（expected 題、remote 由遠端回答、fallbacks 逐題退回、retries 覆蓋不足重打） */
  decisionCoverage?: { expected: number; remote: number; fallbacks: number; retries: number };
  /** RETAIN 量測：決策值是否原封不動進入本報告（夾限、規則覆寫、逐題退回都算不保留） */
  retention?: ReportRetention;
  /** 產生這份報告實際用掉的 token 與 HTTP 請求數（mock／規則為 0） */
  usage?: { inputTokens: number | null; outputTokens: number | null; calls: number };
  verdict: "recommend" | "cautious" | "pass";
  dimensions: Dimension;
  reasons: string[];
  redFlags: string[];
  sharedTopics: string[];
  summaryForUser: string;
}

export interface ReportRetention {
  retained: boolean;
  /** 進入報告的決策 slot 數 */
  slots: number;
  /** 原封不動保留的 slot 數 */
  kept: number;
  /** 被 0-100 換算夾限改寫的 slot id */
  clamped: string[];
  /** 被規則覆寫（或逐題退回規則）的 slot id */
  overridden: string[];
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

export const HACK_CANDIDATE_THRESHOLD = 60; // 雙方門檻（優先／破冰卡／組隊）；判斷一律走 pairGate.ts
