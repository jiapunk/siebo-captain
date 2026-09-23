import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
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

  const evals = await prisma.swarmPart.groupBy({
    by: ["status"],
    where: { teamId: `h:${uid}`, kind: "team_eval" },
    _count: true,
  });
  const providers = await prisma.swarmPart.findMany({
    where: { teamId: `h:${uid}`, kind: "team_eval", provider: { not: null } },
    select: { provider: true },
    distinct: ["provider"],
  });
  const hypotheses = evals.reduce((a, e) => a + e._count, 0);

  return NextResponse.json({
    swarm: {
      hypotheses,
      selected: teams.filter((x) => x.status === "proposed").length,
      failed: evals.find((e) => e.status === "failed")?._count ?? 0,
      providers: providers.map((p) => p.provider as string),
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
