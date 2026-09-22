import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { llm } from "@/lib/llm";
import { getServerLocale } from "@/lib/locale";
import { recordLedger } from "@/lib/ledger";
import { publicProfile } from "@/lib/profile";
import type {
  HackathonProfile,
  IcebreakerCard,
  MatchReport,
  VisibilityMap,
} from "@/lib/types";
import { HACK_CANDIDATE_THRESHOLD } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 產生（或取回快取）對某人的破冰卡 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id: otherId } = await ctx.params;
  if (otherId === uid)
    return NextResponse.json({ error: "self" }, { status: 400 });

  // 找我們之間已完成的互盤
  const run = await prisma.matchRun.findFirst({
    where: {
      status: "completed",
      OR: [
        { userAId: uid, userBId: otherId },
        { userAId: otherId, userBId: uid },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (!run)
    return NextResponse.json({ error: "no_run" }, { status: 404 });

  const isA = run.userAId === uid;
  const report = (isA ? run.reportA : run.reportB) as MatchReport | null;
  if (!report || report.score < HACK_CANDIDATE_THRESHOLD)
    return NextResponse.json({ error: "below_threshold" }, { status: 409 });

  // 快取
  const cached = await prisma.icebreaker.findUnique({
    where: { runId_viewerId: { runId: run.id, viewerId: uid } },
  });
  if (cached)
    return NextResponse.json({
      card: cached.content as unknown as IcebreakerCard,
      cached: true,
    });

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
  if (!myProf?.role || !otherProf?.role)
    return NextResponse.json({ error: "profile_missing" }, { status: 400 });

  const locale = await getServerLocale();
  const card = await llm.icebreakerCard(
    myProf,
    publicProfile(otherProf, (other?.profile?.visibility as VisibilityMap) ?? null),
    run.id,
    run.id,
    locale,
  );

  await recordLedger(uid, "icebreaker", 1, otherId);

  await prisma.icebreaker.upsert({
    where: { runId_viewerId: { runId: run.id, viewerId: uid } },
    update: { content: card as unknown as object },
    create: {
      runId: run.id,
      viewerId: uid,
      content: card as unknown as object,
    },
  });

  return NextResponse.json({ card, cached: false });
}
