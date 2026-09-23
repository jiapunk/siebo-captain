import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { llm } from "@/lib/llm";
import { getServerLocale } from "@/lib/locale";
import { throttle, tryLock } from "@/lib/costGuard";
import { apiError, readJson, route, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Turn = { role: "agent" | "user"; content: string; ts: number };

/**
 * AgentProfile.interview 的 JSON（不改 schema）：{ consentAt, sid, turns }
 * - consentAt：第一輪送出時伺服器記下的同意時間（ms）
 * - sid：這份檔案專用的隨機 id，當作送往 LLM 的 sessionId（x-opencode-session），不用 userId；compile 沿用
 * - turns：訪談逐字稿
 * 舊資料是純 Turn[]（同意機制上線前開始的訪談）：沒有 consentAt，sid 在下一輪補上。
 * onboarding/compile/route.ts 有同樣的解析（route 檔不能匯出其他東西）。
 */
type InterviewDoc = { consentAt?: number; sid?: string; turns: Turn[] };

function readInterview(raw: unknown): InterviewDoc {
  if (Array.isArray(raw)) return { turns: raw as Turn[] };
  if (raw && typeof raw === "object") {
    const o = raw as Partial<InterviewDoc>;
    return {
      consentAt: typeof o.consentAt === "number" ? o.consentAt : undefined,
      sid: typeof o.sid === "string" && o.sid ? o.sid : undefined,
      turns: Array.isArray(o.turns) ? o.turns : [],
    };
  }
  return { turns: [] };
}

/** 單則訪談回答上限（字元） */
const MAX_INTERVIEW_CONTENT = 1000;
/** 一份訪談最多幾則使用者回答（訪談 6 輪就結束，這是防灌爆 DB 的上限） */
const MAX_USER_TURNS = 20;

/**
 * 訪談一輪：使用者回答 → 隊長下一個問題。
 * - 400 content required / content_too_long（附 max）
 * - 400 consent_required：第一輪（訪談還是空的）必須帶 consent: true（隱私告知同意），同意時間存進 interview
 * - 409 in_progress：同一使用者上一則還在處理（避免讀-改-寫互相覆蓋）
 * - 409 interview_too_long：回答數已達上限
 * - 409 already_compiled：檔案已編譯（ready）
 * - 429 rate_limited：每人 20 則 / 分鐘，另有每來源／全站預算（見 costGuard SHARED_LIMITS）
 */
export const POST = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");
  const locale = await getServerLocale();

  const body = await readJson<{ content?: string; consent?: boolean }>(req);
  const content = str(body.content);
  if (!content) return apiError(400, "content required");
  if (content.length > MAX_INTERVIEW_CONTENT)
    return apiError(400, "content_too_long", { max: MAX_INTERVIEW_CONTENT });

  const user = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } });
  if (!user) return apiError(401, "unauthorized");

  const release = tryLock(`onboarding:${uid}`, 2 * 60_000);
  if (!release) return apiError(409, "in_progress");
  try {
    throttle("onboardingMessage", uid, req);

    let profile = await prisma.agentProfile.findUnique({ where: { userId: uid } });
    if (!profile)
      profile = await prisma.agentProfile.create({
        data: { userId: uid, status: "draft", interview: [] },
      });
    if (profile.status === "ready") return apiError(409, "already_compiled");

    const doc = readInterview(profile.interview);
    const turns = doc.turns.slice();
    let consentAt = doc.consentAt;
    if (turns.length === 0) {
      // 第一輪：沒看過隱私告知並同意，就不收（也不送 LLM）
      if (body.consent !== true) return apiError(400, "consent_required");
      consentAt = Date.now();
    }
    if (turns.filter((t) => t.role === "user").length >= MAX_USER_TURNS)
      return apiError(409, "interview_too_long");
    const sid = doc.sid ?? randomBytes(16).toString("hex");

    // 使用者訊息入庫
    turns.push({ role: "user", content, ts: Date.now() });

    const { reply, done } = await llm.interviewTurn(
      turns.map((t) => ({ role: t.role, content: t.content })),
      sid,
      locale,
    );
    turns.push({ role: "agent", content: reply, ts: Date.now() });

    const next = { ...(consentAt !== undefined ? { consentAt } : {}), sid, turns };
    // 只寫回草稿：LLM 回來前檔案若已被編譯（ready），不要把逐字稿寫回去
    const saved = await prisma.agentProfile.updateMany({
      where: { userId: uid, status: { not: "ready" } },
      data: { interview: next as unknown as object },
    });
    if (saved.count === 0) return apiError(409, "already_compiled");

    return NextResponse.json({ reply, done, interview: turns });
  } finally {
    release();
  }
}, "onboarding/message");
