import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { latestRoundHypotheses } from "@/lib/teamAssembler";
import type { TeamReport } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const teams = await prisma.team.findMany({
    where: { members: { some: { userId: uid } } },
    orderBy: { createdAt: "desc" },
    include: {
      members: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const userIds = new Set<string>();
  for (const t of teams) for (const m of t.members) userIds.add(m.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, name: true, emoji: true, isBot: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 最新一輪的假設（teamId=h:<userId>）：舊資料混著好幾輪 → 只取最新一筆 10 分鐘內的 part，
  // 反向重複 ID 同一組隊友只算最新一筆；與網絡模擬同一套計數（teamAssembler.latestRoundHypotheses）
  const evals = latestRoundHypotheses(
    await prisma.swarmPart.findMany({
      where: { teamId: `h:${uid}`, kind: "team_eval" },
      select: { id: true, status: true, provider: true, updatedAt: true },
    }),
  );
  const providers = [...new Set(evals.map((e) => e.provider).filter((p): p is string => !!p))];

  return NextResponse.json({
    swarm: {
      hypotheses: evals.length,
      selected: teams.filter((x) => x.status === "proposed").length,
      failed: evals.filter((e) => e.status === "failed").length,
      providers,
    },
    teams: teams.map((t) => ({
      id: t.id,
      status: t.status,
      score: t.score,
      report: t.report as unknown as TeamReport | null,
      createdAt: t.createdAt,
      lastMessage: t.messages[0]
        ? {
            content: t.messages[0].content,
            senderId: t.messages[0].senderId,
          }
        : null,
      // accepted：真人看 TeamMember.accepted；模擬隊友一律視為已同意
      members: t.members
        .map((m) => {
          const u = userMap.get(m.userId);
          const isBot = u?.isBot ?? false;
          return {
            userId: m.userId,
            name: u?.name ?? "?",
            emoji: u?.emoji ?? "?",
            isBot,
            role: m.role,
            accepted: m.accepted || isBot,
            isMe: m.userId === uid,
          };
        })
        .sort((a, b) => Number(b.isMe) - Number(a.isMe)),
    })),
  });
}
