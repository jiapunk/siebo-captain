import OpenAI from "openai";
import type {
  HackathonProfile,
  IcebreakerCard,
  MatchReport,
} from "../types";
import type { PublicProfile } from "../profile";
import type { Locale } from "../i18n-dict";
import { langDirective } from "./lang";

/**
 * 真實 LLM 端點（OpenAI 相容）。透過 .env 切換：
 *   LLM_PROVIDER=real
 *   LLM_BASE_URL=https://opencode.ai/zen/go/v1   （OpenCode Go 訂閱）
 *             或 https://api.deepseek.com        （DeepSeek 官方）
 *   LLM_API_KEY=sk-xxx
 *   LLM_MODEL=deepseek-v4.1-flash
 *
 * OpenCode Go 規範：
 *   - 需帶專屬 User-Agent（不可用通用 SDK 名）
 *   - 每段對話帶穩定的 x-opencode-session header
 */

const USER_AGENT = "siebo-captain/1.0 (hackathon-teaming)";

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
      apiKey: process.env.LLM_API_KEY || "missing-key",
      defaultHeaders: { "User-Agent": USER_AGENT },
    });
  }
  return _client;
}

const MODEL = process.env.LLM_MODEL || "deepseek-chat";

async function json<T>(
  system: string,
  user: string,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await getClient().chat.completions.create(
        {
          model: MODEL,
          messages: [
            { role: "system", content: system + langDirective(locale) },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.9,
          max_tokens: 6000, // 推理模型的 thinking 會佔用 completion 額度
        },
        { headers: sessionId ? { "x-opencode-session": sessionId } : undefined },
      );
      const raw = res.choices[0]?.message?.content ?? "{}";
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      return JSON.parse(cleaned) as T;
    } catch (e) {
      lastErr = e;
      if (attempt < 2)
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

const LOCALE_DIRECTIVE: Record<Locale, string> = {
  zh: "輸出語言：繁體中文（台灣用語）。",
  cn: "输出语言：简体中文（中国大陆用语）。",
  en: "Output language: English.",
  ja: "出力言語：日本語。",
};

const CAPTAIN_PERSONA =
  "你是用戶的專屬隊長（黑客松組隊代理）。語氣務實、乾脆、帶點幽默；不用 emoji 濫炸。";

const TOPICS = [
  "技術棧與擅長領域",
  "這次參賽的目標：拿獎/學習/認識人",
  "可投入時間：全程還是下班後",
  "合作地雷與自己最罩的地方",
  "喜歡的合作節奏：先架構再動手 / 邊做邊改",
  "作品連結或過去參賽紀錄",
];

export async function realInterviewTurn(
  transcript: { role: "agent" | "user"; content: string }[],
  sessionId?: string,
  locale: Locale = "zh",
): Promise<{ reply: string; done: boolean }> {
  const userCount = transcript.filter((t) => t.role === "user").length;
  const last =
    [...transcript].reverse().find((t) => t.role === "user")?.content ?? "";
  if (userCount >= 6) {
    return {
      reply: `「${last.slice(0, 18)}${last.length > 18 ? "…" : ""}」——收到，你的選手檔案我正在整理，晚點到「我的檔案」確認我要拿去用的版本。`,
      done: true,
    };
  }
  return json<{ reply: string; done: boolean }>(
    "你是用戶的專屬隊長，正在進行建立選手檔案的初次訪談（共 6 題）。話題清單：" +
      TOPICS.map((t, i) => `${i + 1}. ${t}`).join("；") +
      '。規則：先用「…」引用對方上一句的關鍵片段表達傾聽，再自然接續問下一個尚未涵蓋的話題；一次只問一題；絕不重複問過的問題；務實口語；不使用 emoji。只輸出 JSON：{"reply":"...","done":false}',
    `訪談對話：\n${transcript
      .map((t) => `${t.role === "agent" ? "你的訊息" : "用戶"}：${t.content}`)
      .join("\n")}`,
    sessionId,
    locale,
  );
}

export async function realCompileProfile(
  userName: string,
  answers: string[],
  sessionId?: string,
  locale: Locale = "zh",
): Promise<HackathonProfile> {
  return json<HackathonProfile>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      '根據訪談回答編譯選手檔案，只輸出 JSON：{"nickname","role","skills"[],"timezone","availability","goal","workingStyle","vibe","dealbreakers"[],"bio"}。role 從 前端/後端/全端/設計/PM/資料/AI 中選最接近的一個；skills 是技術棧陣列；bio 為 120 字內簡介；nickname 一律用用戶名字。',
    `用戶名字：${userName}\n訪談回答：\n${answers
      .map((a, i) => `${i + 1}. ${a}`)
      .join("\n")}`,
    sessionId,
    locale,
  );
}

export async function realMatchQuestions(
  self: HackathonProfile,
  other: PublicProfile,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<string[]> {
  const r = await json<{ questions: string[] }>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      '你要替自己的用戶訪談另一位參賽者的隊長。配對情境：技能互補（不同角色優於同角色）、參賽目標一致、可投入時間匹配、協作節奏相容、可靠度。生成 3 個最能判斷相容性的問題（繁體中文）。只輸出 JSON：{"questions":[...]}',
    `我的用戶檔案：${JSON.stringify(self)}\n對方檔案：${JSON.stringify(other)}`,
    sessionId,
    locale,
  );
  return r.questions;
}

export async function realMatchAnswers(
  self: HackathonProfile,
  questions: string[],
  sessionId?: string,
  locale: Locale = "zh",
): Promise<string[]> {
  const r = await json<{ answers: string[] }>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      '代表你的用戶回答另一位隊長的提問，忠實根據檔案、簡潔有個性（繁體中文）。只輸出 JSON：{"answers":[...與問題等長]}',
    `我的用戶檔案：${JSON.stringify(self)}\n問題：${questions.join("\n")}`,
    sessionId,
    locale,
  );
  return r.answers;
}

export async function realMatchReport(
  self: HackathonProfile,
  other: PublicProfile,
  qa: string,
  pairKey: string,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<MatchReport> {
  const base = await json<MatchReport>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      '基於對盤紀錄與雙方檔案產出互盤報告。情境指引：技能互補（不同角色優於同角色）、參賽目標一致、可投入時間匹配、協作節奏相容、可靠度；互補比重疊重要。若對方檔案含 github 驗證資料，可作為可信度加分並在 reasons 引用；沒有驗證則在 redFlags 提醒面談時確認實作經驗。dimensions 五個 0-100 分的意義：{"interests":"技能互補","values":"目標一致","lifestyle":"投入程度","communication":"協作風格","intent":"靠譜度"}。只輸出 JSON：{"score":0-100整數,"verdict":"recommend|cautious|pass","dimensions":{"values":0-100,"lifestyle":0-100,"interests":0-100,"communication":0-100,"intent":0-100},"reasons"[],"redFlags"[],"sharedTopics"[],"summaryForUser":"給本人看的摘要兩三句"}。全文不使用 emoji。嚴禁捏造檔案中不存在的資訊；sharedTopics 只能從雙方檔案的交集或對盤中實際出現的話題挑選。',
    `我的用戶檔案：${JSON.stringify(self)}\n對方檔案：${JSON.stringify(
      other,
    )}\n雙方隊長對盤紀錄：\n${qa}\n配對鍵：${pairKey}`,
    sessionId,
    locale,
  );
  return base;
}

export async function realIcebreakerCard(
  self: HackathonProfile,
  other: PublicProfile,
  pairKey: string,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<IcebreakerCard> {
  return json<IcebreakerCard>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      '替用戶生成一張「破冰卡」，幫助他跟一位陌生參賽者開啟對話。只輸出 JSON：{"shared":["共同點最多3個"],"complement":["互補點最多2個"],"risk":"一句話把風險轉譯成可聊的話題(沒有就寫 暫無明顯風險，直接聊)","openers":["三句可以直接複製的開場白，自然、低壓力、務實，各自用到共同點或互補點，每句最多一個表情符號"]}。嚴禁捏造檔案中不存在的資訊。',
    `我的用戶：${JSON.stringify(self)}\n對方：${JSON.stringify(other)}\n配對鍵：${pairKey}`,
    sessionId,
    locale,
  );
}

export async function realTeamReply(
  bot: HackathonProfile,
  history: { senderId: string; content: string }[],
  botId: string,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<string> {
  const r = await json<{ reply: string }>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      `你現在直接扮演你的用戶本人（${bot.nickname}，角色：${bot.role}）在黑客松團隊聊天室回話。根據角色認領工作、給出下一步、自然口語繁體中文、一次最多兩三句、最多一個表情符號。只輸出 JSON：{"reply":"..."}`,
    `我的用戶（你扮演的）：${JSON.stringify(bot)}\n團隊對話（最後為最新訊息）：\n${history
      .map((m) => `${m.senderId === botId ? "我" : "隊友"}：${m.content}`)
      .join("\n")}`,
    sessionId,
    locale,
  );
  return r.reply;
}


export async function realDmReply(
  bot: HackathonProfile,
  history: { senderId: string; content: string }[],
  botId: string,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<string> {
  const res = await json<{ reply: string }>(
    CAPTAIN_PERSONA +
      "你現在直接扮演你的用戶本人在一對一私訊中回話（比團隊頻道更放鬆、像朋友）。自然口語、一次最多兩三句、可以反問、最多一個表情符號。只輸出 JSON：{\"reply\":\"...\"}",
    `我的用戶（你扮演的）：${JSON.stringify(bot)}\n對話紀錄（最後為對方訊息）：\n${history
      .map((h) => `${h.senderId === botId ? "我" : "對方"}：${h.content}`)
      .join("\n")}`,
    sessionId,
    locale,
  );
  return res.reply;
}
