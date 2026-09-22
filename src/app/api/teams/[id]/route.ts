import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { publish } from "@/lib/bus";
import { recordLedger } from "@/lib/ledger";
import type { TeamReport } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: { members: true },
  });
  if (!team || !team.members.some((m) => m.userId === uid))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const users = await prisma.user.findMany({
    where: { id: { in: team.members.map((m) => m.userId) } },
    select: { id: true, name: true, emoji: true, isBot: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    id: team.id,
    status: team.status,
    score: team.score,
    report: team.report as unknown as TeamReport | null,
    members: team.members
      .map((m) => {
        const u = userMap.get(m.userId);
        return {
          userId: m.userId,
          name: u?.name ?? "?",
          emoji: u?.emoji ?? "?",
          isBot: u?.isBot ?? false,
          role: m.role,
          accepted: m.accepted,
          isMe: m.userId === uid,
        };
      })
      .sort((a, b) => Number(b.isMe) - Number(a.isMe)),
  });
}

/** 加入隊伍：本人同意；模擬隊友自動同意 → assembled */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: { members: { include: { user: { select: { isBot: true } } } } },
  });
  if (!team || !team.members.some((m) => m.userId === uid))
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (team.status === "assembled")
    return NextResponse.json({ status: "assembled" });

  await prisma.$transaction([
    prisma.teamMember.update({
      where: { teamId_userId: { teamId: id, userId: uid } },
      data: { accepted: true },
    }),
    ...team.members
      .filter((m) => m.user.isBot)
      .map((m) =>
        prisma.teamMember.update({
          where: { teamId_userId: { teamId: id, userId: m.userId } },
          data: { accepted: true },
        }),
      ),
    prisma.team.update({ where: { id }, data: { status: "assembled" } }),
  ]);

  // 收回我在其他隊伍的未成立提案
  const others = await prisma.team.findMany({
    where: {
      status: "proposed",
      id: { not: id },
      members: { some: { userId: uid } },
    },
    select: { id: true },
  });
  for (const t of others) {
    await prisma.team.delete({ where: { id: t.id } });
  }

  // 帳本：成隊（所有成員，值 = 隊伍分數）
  for (const m of team.members) {
    await recordLedger(m.userId, "team_joined", team.score, id);
  }

  publish(`team:${id}`, { type: "assembled" });
  for (const m of team.members) publish(`user:${m.userId}`, { type: "refresh" });

  return NextResponse.json({ status: "assembled" });
}
