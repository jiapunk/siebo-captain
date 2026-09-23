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
 * 把訪談編譯成結構化檔案（1 次 LLM 呼叫）。
 * - 409 in_progress：同一使用者的編譯還在跑
 * - 429 rate_limited：每人 5 次 / 10 分鐘
 */
export const POST = route(async () => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");

  const release = tryLock(`compile:${uid}`, 3 * 60_000);
  if (!release) return apiError(409, "in_progress");
  try {
    const user = await prisma.user.findUnique({ where: { id: uid } });
    const profile = await prisma.agentProfile.findUnique({ where: { userId: uid } });
    if (!user || !profile) return apiError(400, "no profile");
    if (profile.status === "ready") return apiError(409, "already_compiled");

    const interview = (profile.interview as unknown as Turn[]) ?? [];
    const answers = interview
      .filter((t) => t.role === "user")
      .map((t) => t.content);
    if (answers.length < 4) return apiError(400, "interview_incomplete");

    throttle("onboardingCompile", uid);

    const locale = await getServerLocale();
    const compiled = await llm.compileProfile(user.name, answers, uid, locale);

    await prisma.agentProfile.update({
      where: { userId: uid },
      data: {
        compiled: compiled as unknown as object,
        visibility: { ...HACK_VISIBILITY } as unknown as object,
        status: "ready",
      },
    });

    return NextResponse.json({ compiled });
  } finally {
    release();
  }
}, "onboarding/compile");
