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

export const llm: LLMClient =
  LLM_MODE === "real"
    ? {
        interviewTurn: real.realInterviewTurn,
        compileProfile: real.realCompileProfile,
        matchQuestions: real.realMatchQuestions,
        matchAnswers: real.realMatchAnswers,
        matchReport: real.realMatchReport,
        icebreakerCard: real.realIcebreakerCard,
        teamReply: real.realTeamReply,
        dmReply: real.realDmReply,
      }
    : LLM_MODE === "hybrid"
    ? {
        interviewTurn: real.realInterviewTurn,
        compileProfile: real.realCompileProfile,
        matchQuestions: real.realMatchQuestions,
        matchAnswers: real.realMatchAnswers,
        matchReport: mock.decisionMatchReport,
        icebreakerCard: real.realIcebreakerCard,
        teamReply: real.realTeamReply,
        dmReply: real.realDmReply,
      }
    : {
        interviewTurn: mock.mockInterviewTurn,
        compileProfile: mock.mockCompileProfile,
        matchQuestions: mock.mockMatchQuestions,
        matchAnswers: mock.mockMatchAnswers,
        matchReport: mock.mockMatchReport,
        icebreakerCard: mock.mockIcebreakerCard,
        teamReply: mock.mockTeamReply,
        dmReply: mock.mockDmReply,
      };
