import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { publicProfile } from "@/lib/profile";
import type {
  HackathonProfile,
  MatchReport,
  VisibilityMap,
  IcebreakerCard,
} from "@/lib/types";
import { HACK_CANDIDATE_THRESHOLD } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 破冰雷達：我的隊長盤點過、值得先聊的人（附快取的破冰卡） */
export async function GET() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const runs = await prisma.matchRun.findMany({
    where: {
      status: "completed",
      OR: [{ userAId: uid }, { userBId: uid }],
    },
    orderBy: { createdAt: "desc" },
  });

  const seen = new Set<string>();
  const items: Array<{
    userId: string;
    runId: string;
    name: string;
    emoji: string;
    score: number;
    band: "priority" | "watch";
    role: string;
    skills: string[];
    goal: string;
    availability: string;
    summaryForUser: string;
    sharedTopics: string[];
    card: IcebreakerCard | null;
  }> = [];

  for (const r of runs) {
    const isA: boolean = r.userAId === uid;
    const otherId: string = isA ? r.userBId : r.userAId;
    if (otherId === uid || seen.has(otherId)) continue;
    const report = (isA ? r.reportA : r.reportB) as MatchReport | null;
    if (!report || report.score < 50) continue;

    const row = await prisma.user.findUnique({
      where: { id: otherId },
      include: { profile: true },
    });
    const prof = row?.profile?.compiled as unknown as HackathonProfile | null;
    if (!row?.profile || !prof?.role) continue;

    seen.add(otherId);
    const pub = publicProfile(
      prof,
      (row.profile.visibility as VisibilityMap) ?? null,
    );
    const cached = await prisma.icebreaker.findUnique({
      where: { runId_viewerId: { runId: r.id, viewerId: uid } },
    });

    items.push({
      userId: otherId,
      runId: r.id,
      name: row.name,
      emoji: row.emoji,
      score: report.score,
      band: report.score >= HACK_CANDIDATE_THRESHOLD ? "priority" : "watch",
      role: pub.role,
      skills: (pub.skills ?? []).slice(0, 4),
      goal: pub.goal,
      availability: pub.availability,
      summaryForUser: report.summaryForUser,
      sharedTopics: report.sharedTopics,
      card: (cached?.content as unknown as IcebreakerCard) ?? null,
    });
  }

  items.sort((a, b) => b.score - a.score);
  return NextResponse.json({ people: items.slice(0, 6) });
}
