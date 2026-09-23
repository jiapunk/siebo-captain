import type {
  HackathonProfile,
  IcebreakerCard,
  MatchReport,
} from "../types";
import type { Locale } from "../i18n-dict";
import type { PublicProfile } from "../profile";
import * as mock from "./mock";
import * as real from "./real";

const HAS_LLM_KEY = Boolean(process.env.LLM_API_KEY);

/**
 * mock   規則引擎（offline、測試）
 * real   全部由 LLM 生成
 * hybrid LLM 負責對談/文案 + 決策層（Jev，失敗退規則）負責互盤評分
 */
export const LLM_MODE: "mock" | "real" | "hybrid" =
  process.env.LLM_PROVIDER === "real" && HAS_LLM_KEY
    ? "real"
    : process.env.LLM_PROVIDER === "hybrid" && HAS_LLM_KEY
      ? "hybrid"
      : "mock";

export interface LLMClient {
  interviewTurn(
    transcript: { role: "agent" | "user"; content: string }[],
    sessionId?: string,
    locale?: Locale,
  ): Promise<{ reply: string; done: boolean }>;
  compileProfile(
    userName: string,
    answers: string[],
    sessionId?: string,
    locale?: Locale,
  ): Promise<HackathonProfile>;
  matchQuestions(
    self: HackathonProfile,
    other: PublicProfile,
    sessionId?: string,
    locale?: Locale,
  ): Promise<string[]>;
  matchAnswers(
    self: HackathonProfile,
    questions: string[],
    sessionId?: string,
    locale?: Locale,
  ): Promise<string[]>;
  matchReport(
    self: HackathonProfile,
    other: PublicProfile,
    qa: string,
    pairKey: string,
    sessionId?: string,
    locale?: Locale,
  ): Promise<MatchReport>;
  icebreakerCard(
    self: HackathonProfile,
    other: PublicProfile,
    pairKey: string,
    sessionId?: string,
    locale?: Locale,
  ): Promise<IcebreakerCard>;
  teamReply(
    bot: HackathonProfile,
    history: { senderId: string; content: string }[],
    botId: string,
    sessionId?: string,
    locale?: Locale,
  ): Promise<string>;
  dmReply(
    bot: HackathonProfile,
    history: { senderId: string; content: string }[],
    botId: string,
    sessionId?: string,
    locale?: Locale,
  ): Promise<string>;
}

/** 本機腳本引擎（零外送、不會失敗）：mock 模式的主體，也是 real/hybrid 對談 Part 的最後退路 */
export const localLlm: LLMClient = {
  interviewTurn: mock.mockInterviewTurn,
  compileProfile: mock.mockCompileProfile,
  matchQuestions: mock.mockMatchQuestions,
  matchAnswers: mock.mockMatchAnswers,
  matchReport: mock.mockMatchReport,
  icebreakerCard: mock.mockIcebreakerCard,
  teamReply: mock.mockTeamReply,
  dmReply: mock.mockDmReply,
};

/**
 * 直接給 API 路由用的 LLM 呼叫（訪談、編譯檔案、破冰卡、隊友回話）：
 * real.ts 重試後仍失敗 → 改用本機腳本，流程不中斷（伺服器 log 會記一筆 warning）。
 * 互盤的提問／作答／報告不在這裡退回：由 matching.runPart 處理，才能把 fallback 記進 Part 軌跡。
 */
function withLocalFallback<A extends unknown[], R>(
  name: string,
  remote: (...args: A) => Promise<R>,
  local: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    try {
      return await remote(...args);
    } catch (e) {
      console.warn(`[llm] ${name} failed → local script: ${(e as Error)?.message ?? e}`);
      return local(...args);
    }
  };
}

const remoteCommon = {
  interviewTurn: withLocalFallback("interviewTurn", real.realInterviewTurn, mock.mockInterviewTurn),
  compileProfile: withLocalFallback("compileProfile", real.realCompileProfile, mock.mockCompileProfile),
  matchQuestions: real.realMatchQuestions,
  matchAnswers: real.realMatchAnswers,
  icebreakerCard: withLocalFallback("icebreakerCard", real.realIcebreakerCard, mock.mockIcebreakerCard),
  teamReply: withLocalFallback("teamReply", real.realTeamReply, mock.mockTeamReply),
  dmReply: withLocalFallback("dmReply", real.realDmReply, mock.mockDmReply),
};

export const llm: LLMClient =
  LLM_MODE === "real"
    ? { ...remoteCommon, matchReport: real.realMatchReport }
    : LLM_MODE === "hybrid"
      ? { ...remoteCommon, matchReport: mock.decisionMatchReport }
      : localLlm;
