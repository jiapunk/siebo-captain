import OpenAI from "openai";
import type {
  HackathonProfile,
  IcebreakerCard,
  MatchReport,
} from "../types";
import type { PublicProfile } from "../profile";
import type { Locale } from "../i18n-dict";
import { langDirective } from "./lang";
import { recordCall, recordUsage } from "./meter";
import { PROMPT_DATA_RULE, promptData, sanitizeProfile } from "../profile";

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

/** 單次 LLM 請求逾時（毫秒）：涵蓋連線、等待與讀完回應 */
const LLM_TIMEOUT_MS = () => {
  const n = Number(process.env.LLM_TIMEOUT_MS || 45000);
  return Number.isFinite(n) && n > 0 ? n : 45000;
};
/** real.ts 自身只重試 1 次（總共 2 次嘗試）；SDK 不再自行重試，Part 級重試由 swarm.runPart 負責 */
const JSON_ATTEMPTS = 2;

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
      apiKey: process.env.LLM_API_KEY || "missing-key",
      defaultHeaders: { "User-Agent": USER_AGENT },
      maxRetries: 0,
      timeout: LLM_TIMEOUT_MS(),
    });
  }
  return _client;
}

const MODEL = process.env.LLM_MODEL || "deepseek-chat";

/** LLM 回應格式不符（缺欄位、型別錯）：可重試 */
export class LlmShapeError extends Error {
  constructor(msg: string) {
    super(`llm bad_response: ${msg}`);
    this.name = "LlmShapeError";
  }
}

/** 4xx（429 除外）重試也不會好：直接丟出，交給上層 fallback */
function retryable(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 429)
    return false;
  return true;
}

/** sessionId 會進 HTTP header：只保留可列印 ASCII（例如 seed-Demo阿飛 這類 id 會讓 header 丟 ByteString 錯誤） */
function safeSid(s?: string): string | undefined {
  const v = (s ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  return v || undefined;
}

async function json<T>(
  system: string,
  user: string,
  sessionId?: string,
  locale: Locale = "zh",
  validate?: (raw: unknown) => T,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < JSON_ATTEMPTS; attempt++) {
    try {
      recordCall({ isRetry: attempt > 0 });
      const res = await getClient().chat.completions.create(
        {
          model: MODEL,
          messages: [
            { role: "system", content: system + "\n" + PROMPT_DATA_RULE + langDirective(locale) },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          temperature: 0.9,
          max_tokens: 6000, // 推理模型的 thinking 會佔用 completion 額度
        },
        {
          headers: safeSid(sessionId) ? { "x-opencode-session": safeSid(sessionId)! } : undefined,
          signal: AbortSignal.timeout(LLM_TIMEOUT_MS()),
          maxRetries: 0,
        },
      );
      recordUsage(res.usage?.prompt_tokens, res.usage?.completion_tokens);
      const raw = res.choices[0]?.message?.content ?? "{}";
      const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const parsed = JSON.parse(cleaned) as unknown;
      return validate ? validate(parsed) : (parsed as T);
    } catch (e) {
      lastErr = e;
      if (!retryable(e)) break;
      if (attempt < JSON_ATTEMPTS - 1)
        await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw lastErr;
}

// ---------- 回應驗證（欄位完整才算成功；否則 throw → 重試 → fallback） ----------
const obj = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new LlmShapeError("not an object");
  return raw as Record<string, unknown>;
};
const strList = (v: unknown, field: string, min = 1): string[] => {
  if (!Array.isArray(v)) throw new LlmShapeError(`${field} is not an array`);
  const out = v
    .filter((x) => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim())
    .filter(Boolean);
  if (out.length < min) throw new LlmShapeError(`${field} has ${out.length} items`);
  return out;
};
const clampScore = (v: unknown, field: string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n))
    throw new LlmShapeError(`${field} is not a number`);
  return Math.max(0, Math.min(100, Math.round(n)));
};

export function validateQuestions(raw: unknown): string[] {
  return strList(obj(raw).questions, "questions").slice(0, 5);
}

export function validateAnswers(raw: unknown, questions: string[]): string[] {
  const list = strList(obj(raw).answers, "answers");
  if (list.length < questions.length)
    throw new LlmShapeError(`answers ${list.length}/${questions.length}`);
  return list.slice(0, questions.length);
}

export function validateReport(raw: unknown): MatchReport {
  const r = obj(raw);
  const d = obj(r.dimensions);
  const verdict = r.verdict;
  if (verdict !== "recommend" && verdict !== "cautious" && verdict !== "pass")
    throw new LlmShapeError("verdict");
  const list = (v: unknown) =>
    Array.isArray(v)
      ? v.filter((x) => typeof x === "string").map((x) => (x as string).trim()).filter(Boolean)
      : [];
  const summary = typeof r.summaryForUser === "string" ? r.summaryForUser.trim() : "";
  if (!summary) throw new LlmShapeError("summaryForUser");
  return {
    score: clampScore(r.score, "score"),
    verdict,
    dimensions: {
      values: clampScore(d.values, "dimensions.values"),
      lifestyle: clampScore(d.lifestyle, "dimensions.lifestyle"),
      interests: clampScore(d.interests, "dimensions.interests"),
      communication: clampScore(d.communication, "dimensions.communication"),
      intent: clampScore(d.intent, "dimensions.intent"),
    },
    reasons: list(r.reasons),
    redFlags: list(r.redFlags),
    sharedTopics: list(r.sharedTopics),
    summaryForUser: summary,
  };
}

function validateCard(raw: unknown): IcebreakerCard {
  const r = obj(raw);
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string") as string[] : [];
  const openers = strList(r.openers, "openers");
  return {
    shared: list(r.shared),
    complement: list(r.complement),
    risk: typeof r.risk === "string" ? r.risk : "",
    openers,
  };
}

function validateReply(raw: unknown): string {
  const reply = obj(raw).reply;
  if (typeof reply !== "string" || !reply.trim()) throw new LlmShapeError("reply");
  return reply;
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
    promptData(
      "INTERVIEW",
      transcript
        .map((t) => `${t.role === "agent" ? "你的訊息" : "用戶"}：${t.content.slice(0, 2000)}`)
        .join("\n"),
    ),
    sessionId,
    locale,
    (raw) => ({ reply: validateReply(raw), done: Boolean(obj(raw).done) }),
  );
}

export async function realCompileProfile(
  userName: string,
  answers: string[],
  sessionId?: string,
  locale: Locale = "zh",
): Promise<HackathonProfile> {
  const compiled = await json<HackathonProfile>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      '根據訪談回答編譯選手檔案，只輸出 JSON：{"nickname","role","skills"[],"timezone","availability","goal","workingStyle","vibe","dealbreakers"[],"bio"}。role 從 前端/後端/全端/設計/PM/資料/AI 中選最接近的一個；skills 是技術棧陣列；bio 為 120 字內簡介；nickname 一律用用戶名字。',
    `用戶名字：${userName.slice(0, 40)}\n訪談回答：\n${promptData(
      "ANSWERS",
      answers.map((a, i) => `${i + 1}. ${a.slice(0, 2000)}`).join("\n"),
    )}`,
    sessionId,
    locale,
    (raw) => {
      const p = sanitizeProfile(obj(raw));
      if (!p.role) throw new LlmShapeError("role");
      return p;
    },
  );
  return { ...compiled, nickname: compiled.nickname || userName.slice(0, 40) };
}

/**
 * 互盤提問／作答／報告：雙方檔案都只收「投影後」的版本（呼叫端負責 publicProfile），
 * 這裡再做一次 sanitize（長度上限、型別）並包進資料區塊。
 */
export async function realMatchQuestions(
  self: HackathonProfile,
  other: PublicProfile,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<string[]> {
  return json<string[]>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      '你要替自己的用戶訪談另一位參賽者的隊長。配對情境：技能互補（不同角色優於同角色）、參賽目標一致、可投入時間匹配、協作節奏相容、可靠度。生成 3 個最能判斷相容性的問題。問題會直接給對方看到：只能引用下面資料區塊裡出現的內容。只輸出 JSON：{"questions":[...]}',
    `我的用戶檔案：\n${promptData("MY_PROFILE", sanitizeProfile(self))}\n對方檔案：\n${promptData(
      "OTHER_PROFILE",
      sanitizeProfile(other),
    )}`,
    sessionId,
    locale,
    validateQuestions,
  );
}

export async function realMatchAnswers(
  self: HackathonProfile,
  questions: string[],
  sessionId?: string,
  locale: Locale = "zh",
): Promise<string[]> {
  const qs = questions.map((q) => q.slice(0, 400));
  return json<string[]>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      `代表你的用戶回答另一位隊長的提問，忠實根據檔案、簡潔有個性。回答會直接給對方看到：只能使用檔案資料區塊裡出現的內容，標示「未公開」或空白的欄位一律不透露也不猜測。answers 陣列必須剛好 ${qs.length} 則、順序對應問題。只輸出 JSON：{"answers":[...]}`,
    `我的用戶檔案：\n${promptData("MY_PROFILE", sanitizeProfile(self))}\n問題：\n${promptData(
      "QUESTIONS",
      qs.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    )}`,
    sessionId,
    locale,
    (raw) => validateAnswers(raw, qs),
  );
}

export async function realMatchReport(
  self: HackathonProfile,
  other: PublicProfile,
  qa: string,
  pairKey: string,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<MatchReport> {
  return json<MatchReport>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      '基於對盤紀錄與雙方檔案產出互盤報告。情境指引：技能互補（不同角色優於同角色）、參賽目標一致、可投入時間匹配、協作節奏相容、可靠度；互補比重疊重要。若對方檔案含 github 驗證資料，可作為可信度加分並在 reasons 引用；沒有驗證則在 redFlags 提醒面談時確認實作經驗。dimensions 五個 0-100 分的意義：{"interests":"技能互補","values":"目標一致","lifestyle":"投入程度","communication":"協作風格","intent":"靠譜度"}。只輸出 JSON：{"score":0-100整數,"verdict":"recommend|cautious|pass","dimensions":{"values":0-100,"lifestyle":0-100,"interests":0-100,"communication":0-100,"intent":0-100},"reasons"[],"redFlags"[],"sharedTopics"[],"summaryForUser":"給本人看的摘要兩三句"}。全文不使用 emoji。嚴禁捏造檔案中不存在的資訊；報告雙方都看得到，標示「未公開」的欄位不得猜測或透露；sharedTopics 只能從雙方檔案的交集或對盤中實際出現的話題挑選。',
    `我的用戶檔案：\n${promptData("MY_PROFILE", sanitizeProfile(self))}\n對方檔案：\n${promptData(
      "OTHER_PROFILE",
      sanitizeProfile(other),
    )}\n雙方隊長對盤紀錄：\n${promptData("TRANSCRIPT", qa.slice(0, 6000))}\n配對鍵：${pairKey}`,
    sessionId,
    locale,
    validateReport,
  );
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
    `我的用戶：\n${promptData("MY_PROFILE", sanitizeProfile(self))}\n對方：\n${promptData(
      "OTHER_PROFILE",
      sanitizeProfile(other),
    )}\n配對鍵：${pairKey}`,
    sessionId,
    locale,
    validateCard,
  );
}

const historyBlock = (
  history: { senderId: string; content: string }[],
  botId: string,
  me: string,
  them: string,
) =>
  promptData(
    "CHAT",
    history
      .slice(-30)
      .map((m) => `${m.senderId === botId ? me : them}：${m.content.slice(0, 1000)}`)
      .join("\n"),
  );

export async function realTeamReply(
  bot: HackathonProfile,
  history: { senderId: string; content: string }[],
  botId: string,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<string> {
  const b = sanitizeProfile(bot);
  return json<string>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      `你現在直接扮演你的用戶本人（${b.nickname}，角色：${b.role}）在黑客松團隊聊天室回話。根據角色認領工作、給出下一步、自然口語、一次最多兩三句、最多一個表情符號。只輸出 JSON：{"reply":"..."}`,
    `我的用戶（你扮演的）：\n${promptData("MY_PROFILE", b)}\n團隊對話（最後為最新訊息）：\n${historyBlock(
      history,
      botId,
      "我",
      "隊友",
    )}`,
    sessionId,
    locale,
    validateReply,
  );
}


export async function realDmReply(
  bot: HackathonProfile,
  history: { senderId: string; content: string }[],
  botId: string,
  sessionId?: string,
  locale: Locale = "zh",
): Promise<string> {
  return json<string>(
    CAPTAIN_PERSONA +
      LOCALE_DIRECTIVE[locale] +
      "你現在直接扮演你的用戶本人在一對一私訊中回話（比團隊頻道更放鬆、像朋友）。自然口語、一次最多兩三句、可以反問、最多一個表情符號。只輸出 JSON：{\"reply\":\"...\"}",
    `我的用戶（你扮演的）：\n${promptData("MY_PROFILE", sanitizeProfile(bot))}\n對話紀錄（最後為對方訊息）：\n${historyBlock(
      history,
      botId,
      "我",
      "對方",
    )}`,
    sessionId,
    locale,
    validateReply,
  );
}
