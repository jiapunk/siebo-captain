import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { llm } from "@/lib/llm";
import { getServerLocale } from "@/lib/locale";
import { recordLedger } from "@/lib/ledger";
import { publicProfile } from "@/lib/profile";
import { radarBand } from "@/lib/pairGate";
import { singleFlight, throttle } from "@/lib/costGuard";
import { apiError, isId, route } from "@/lib/http";
import type { HackathonProfile, IcebreakerCard, VisibilityMap } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 產生（或取回快取）對某人的破冰卡。
 * 門檻與雷達一致（src/lib/pairGate.ts 的 radarBand）：雙方分數都 ≥ 50（watch 或 priority）就能生成；
 * 不在雷達上 → 409 below_threshold。回應附 band。
 * 同一 run、同一觀看者只生成一次：已有就重用；生成中的並發請求共用同一次 LLM 呼叫（不重複記帳）。
 */
export const POST = route(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const uid = await getCurrentUserId();
    if (!uid) return apiError(401, "unauthorized");
    const { id: otherId } = await ctx.params;
    if (!isId(otherId)) return apiError(400, "invalid_user");
    if (otherId === uid) return apiError(400, "self");

    const gate = await emailGate(uid);
    if (gate) return apiError(403, gate);

    // 找我們之間最新一場已完成的互盤（與 /api/people 同規則：目前活動內、最新一筆、不論分數）
    const membership = await prisma.eventMember.findFirst({
      where: { userId: uid },
      orderBy: { joinedAt: "desc" },
      select: { eventId: true },
    });
    const run = await prisma.matchRun.findFirst({
      where: {
        status: "completed",
        OR: [
          { userAId: uid, userBId: otherId },
          { userAId: otherId, userBId: uid },
        ],
        ...(membership?.eventId ? { eventId: membership.eventId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (!run) return apiError(404, "no_run");

    const band = radarBand(run, uid);
    if (!band) return apiError(409, "below_threshold");

    const cacheKey = { runId_viewerId: { runId: run.id, viewerId: uid } };
    const cached = await prisma.icebreaker.findUnique({ where: cacheKey });
    if (cached)
      return NextResponse.json({
        card: cached.content as unknown as IcebreakerCard,
        cached: true,
        band,
      });

    const result = await singleFlight(`icebreaker:${run.id}:${uid}`, async () => {
      // 前一個 flight 可能剛寫入
      const again = await prisma.icebreaker.findUnique({ where: cacheKey });
      if (again)
        return { card: again.content as unknown as IcebreakerCard, cached: true };

      throttle("icebreaker", uid, req);

      const [me, other] = await Promise.all([
        prisma.user.findUnique({ where: { id: uid }, include: { profile: true } }),
        prisma.user.findUnique({
          where: { id: otherId },
          include: { profile: true },
        }),
      ]);
      const myProf = me?.profile?.compiled as unknown as HackathonProfile | null;
      const otherProf = other?.profile?.compiled as unknown as
        | HackathonProfile
        | null;
      if (!myProf?.role || !otherProf?.role) return null;

      const locale = await getServerLocale();
      const card = await llm.icebreakerCard(
        myProf,
        publicProfile(otherProf, (other?.profile?.visibility as VisibilityMap) ?? null),
        run.id,
        run.id,
        locale,
      );

      await prisma.icebreaker.upsert({
        where: cacheKey,
        update: { content: card as unknown as object },
        create: {
          runId: run.id,
          viewerId: uid,
          content: card as unknown as object,
        },
      });
      await recordLedger(uid, "icebreaker", 1, otherId);
      return { card, cached: false };
    });

    if (!result) return apiError(400, "profile_missing");
    return NextResponse.json({ ...result, band });
  },
  "people/[id]/icebreakers",
);
