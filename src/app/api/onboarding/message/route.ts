import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { llm } from "@/lib/llm";
import { getServerLocale } from "@/lib/locale";
import { throttle, tryLock } from "@/lib/costGuard";
import { apiError, readJson, route, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Turn = { role: "agent" | "user"; content: string; ts: number };

/** 單則訪談回答上限（字元） */
const MAX_INTERVIEW_CONTENT = 1000;
/** 一份訪談最多幾則使用者回答（訪談 6 輪就結束，這是防灌爆 DB 的上限） */
const MAX_USER_TURNS = 20;

/**
 * 訪談一輪：使用者回答 → 隊長下一個問題。
 * - 400 content required / content_too_long（附 max）
 * - 409 in_progress：同一使用者上一則還在處理（避免讀-改-寫互相覆蓋）
 * - 409 interview_too_long：回答數已達上限
 * - 429 rate_limited：每人 20 則 / 分鐘
 */
export const POST = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");
  const locale = await getServerLocale();

  const body = await readJson<{ content?: string }>(req);
  const content = str(body.content);
  if (!content) return apiError(400, "content required");
  if (content.length > MAX_INTERVIEW_CONTENT)
    return apiError(400, "content_too_long", { max: MAX_INTERVIEW_CONTENT });

  const user = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } });
  if (!user) return apiError(401, "unauthorized");

  const release = tryLock(`onboarding:${uid}`, 2 * 60_000);
  if (!release) return apiError(409, "in_progress");
  try {
    throttle("onboardingMessage", uid);

    let profile = await prisma.agentProfile.findUnique({ where: { userId: uid } });
    if (!profile)
      profile = await prisma.agentProfile.create({
        data: { userId: uid, status: "draft", interview: [] },
      });
    if (profile.status === "ready") return apiError(409, "already_compiled");

    const interview = ((profile.interview as unknown as Turn[]) ?? []).slice();
    if (interview.filter((t) => t.role === "user").length >= MAX_USER_TURNS)
      return apiError(409, "interview_too_long");

    // 使用者訊息入庫
    interview.push({ role: "user", content, ts: Date.now() });

    const { reply, done } = await llm.interviewTurn(
      interview.map((t) => ({ role: t.role, content: t.content })),
      uid,
      locale,
    );
    interview.push({ role: "agent", content: reply, ts: Date.now() });

    await prisma.agentProfile.update({
      where: { userId: uid },
      data: { interview: interview as unknown as object[] },
    });

    return NextResponse.json({ reply, done, interview });
  } finally {
    release();
  }
}, "onboarding/message");
