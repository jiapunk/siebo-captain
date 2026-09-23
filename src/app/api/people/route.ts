import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { publicProfile } from "@/lib/profile";
import { latestRunPerPeer, pairScores, radarBand } from "@/lib/pairGate";
import type {
  HackathonProfile,
  MatchReport,
  VisibilityMap,
  IcebreakerCard,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 破冰雷達：我的隊長盤點過、值得先聊的人（附快取的破冰卡）
 *
 * 規則（pairGate 單一來源）：
 *   - 每位對象只看「最新一筆」完成的互盤（新評估判不合格時，舊的合格評估不會復活）
 *   - 雙方隊長分數都 ≥ 50 才上雷達（watch），都 ≥ 60 為優先（priority）
 */
export async function GET() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const membership = await prisma.eventMember.findFirst({
    where: { userId: uid },
    orderBy: { joinedAt: "desc" },
  });

  const runs = await prisma.matchRun.findMany({
    where: {
      status: "completed",
      OR: [{ userAId: uid }, { userBId: uid }],
      ...(membership?.eventId ? { eventId: membership.eventId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  const latest = latestRunPerPeer(runs, uid);
  const eligible = [...latest.entries()]
    .map(([otherId, run]) => ({ otherId, run, band: radarBand(run, uid) }))
    .filter(
      (e): e is typeof e & { band: "priority" | "watch" } => e.band !== null,
    );

  const users = await prisma.user.findMany({
    where: { id: { in: eligible.map((e) => e.otherId) } },
    include: { profile: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 破冰卡快取：優先用最新 run 的卡；沒有就沿用同一位對象較早 run 的卡（重跑互盤不會讓卡消失）
  const runIdsByPeer = new Map<string, string[]>();
  for (const r of runs) {
    const other = r.userAId === uid ? r.userBId : r.userAId;
    if (!latest.has(other)) continue;
    runIdsByPeer.set(other, [...(runIdsByPeer.get(other) ?? []), r.id]);
  }
  const cards = await prisma.icebreaker.findMany({
    where: {
      viewerId: uid,
      runId: { in: eligible.flatMap((e) => runIdsByPeer.get(e.otherId) ?? []) },
    },
    orderBy: { createdAt: "desc" },
  });
  const cardByRun = new Map<string, IcebreakerCard>();
  for (const c of cards)
    if (!cardByRun.has(c.runId)) cardByRun.set(c.runId, c.content as unknown as IcebreakerCard);

  const items: Array<{
    userId: string;
    runId: string;
    name: string;
    emoji: string;
    /** 我的隊長給對方的分數 */
    score: number;
    /** 對方隊長給我的分數 */
    theirScore: number;
    /** 雙方較低分（雷達分級依據） */
    pairScore: number;
    band: "priority" | "watch";
    role: string;
    skills: string[];
    goal: string;
    availability: string;
    summaryForUser: string;
    sharedTopics: string[];
    card: IcebreakerCard | null;
  }> = [];

  for (const { otherId, run: r, band } of eligible) {
    const row = userMap.get(otherId);
    const prof = row?.profile?.compiled as unknown as HackathonProfile | null;
    if (!row?.profile || !prof) continue;
    const pub = publicProfile(
      prof,
      (row.profile.visibility as VisibilityMap) ?? null,
    );
    if (!pub.role) continue;

    const { mine, theirs, min } = pairScores(r, uid);
    const report = (r.userAId === uid ? r.reportA : r.reportB) as MatchReport | null;
    const peerRuns = runIdsByPeer.get(otherId) ?? [r.id];
    const card =
      cardByRun.get(r.id) ??
      peerRuns.map((id) => cardByRun.get(id)).find(Boolean) ??
      null;

    items.push({
      userId: otherId,
      runId: r.id,
      name: row.name,
      emoji: row.emoji,
      score: mine ?? 0,
      theirScore: theirs ?? 0,
      pairScore: min ?? 0,
      band,
      role: pub.role,
      skills: (pub.skills ?? []).slice(0, 4),
      goal: pub.goal,
      availability: pub.availability,
      summaryForUser: report?.summaryForUser ?? "",
      sharedTopics: report?.sharedTopics ?? [],
      card,
    });
  }

  items.sort((a, b) => b.pairScore - a.pairScore || b.score - a.score);
  return NextResponse.json({ people: items.slice(0, 6) });
}
