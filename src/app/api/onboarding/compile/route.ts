import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { llm } from "@/lib/llm";
import { getServerLocale } from "@/lib/locale";
import { HACK_VISIBILITY } from "@/lib/types";
import { throttle, tryLock } from "@/lib/costGuard";
import { apiError, route } from "@/lib/http";

export const dynamic = "force-dynamic";

type Turn = { role: "agent" | "user"; content: string; ts: number };

/**
 * AgentProfile.interview 的 JSON：{ consentAt, sid, turns }（格式說明見 onboarding/message/route.ts）。
 * 舊資料是純 Turn[]。
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

/**
 * 把訪談編譯成結構化檔案（1 次 LLM 呼叫）。
 * 編譯完成（status=ready）時同時清空訪談原文：之後沒有任何地方會再讀它，只留 consentAt 與清除時間。
 * - 409 in_progress：同一使用者的編譯還在跑
 * - 429 rate_limited：每人 5 次 / 10 分鐘，另有每來源／全站預算（見 costGuard SHARED_LIMITS）
 */
export const POST = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");

  const release = tryLock(`compile:${uid}`, 3 * 60_000);
  if (!release) return apiError(409, "in_progress");
  try {
    const user = await prisma.user.findUnique({ where: { id: uid } });
    const profile = await prisma.agentProfile.findUnique({ where: { userId: uid } });
    if (!user || !profile) return apiError(400, "no profile");
    if (profile.status === "ready") return apiError(409, "already_compiled");

    const doc = readInterview(profile.interview);
    const answers = doc.turns
      .filter((t) => t.role === "user")
      .map((t) => t.content);
    if (answers.length < 4) return apiError(400, "interview_incomplete");

    throttle("onboardingCompile", uid, req);

    const locale = await getServerLocale();
    // sessionId 沿用訪談時的隨機 id（舊資料沒有就臨時產生一個），不送 userId
    const sid = doc.sid ?? randomBytes(16).toString("hex");
    const compiled = await llm.compileProfile(user.name, answers, sid, locale);

    await prisma.agentProfile.update({
      where: { userId: uid },
      data: {
        compiled: compiled as unknown as object,
        visibility: { ...HACK_VISIBILITY } as unknown as object,
        status: "ready",
        interview: {
          ...(doc.consentAt !== undefined ? { consentAt: doc.consentAt } : {}),
          turns: [],
          clearedAt: Date.now(),
        },
      },
    });

    return NextResponse.json({ compiled });
  } finally {
    release();
  }
}, "onboarding/compile");
