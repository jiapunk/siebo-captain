import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { publish } from "@/lib/bus";
import { recordLedger } from "@/lib/ledger";
import { tryLock } from "@/lib/costGuard";
import { apiError, route } from "@/lib/http";
import type { TeamReport } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * 隊伍詳情。members[].accepted：真人看 TeamMember.accepted；模擬隊友（bot）一律視為已同意。
 * pending：還沒同意的真人 userId（proposed 隊伍才會有）。
 */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");
  const { id } = await ctx.params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: { members: true },
  });
  if (!team || !team.members.some((m) => m.userId === uid))
    return apiError(404, "not found");

  const users = await prisma.user.findMany({
    where: { id: { in: team.members.map((m) => m.userId) } },
    select: { id: true, name: true, emoji: true, isBot: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const members = team.members
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
    .sort((a, b) => Number(b.isMe) - Number(a.isMe));

  return NextResponse.json({
    id: team.id,
    status: team.status,
    score: team.score,
    report: team.report as unknown as TeamReport | null,
    members,
    pending: team.status === "proposed"
      ? members.filter((m) => !m.accepted).map((m) => m.userId)
      : [],
  });
}, "teams/[id] GET");

/**
 * 加入隊伍＝本人同意。只把「自己」的 TeamMember.accepted 設為 true（模擬隊友視為已同意）。
 * 所有真人成員都同意後才轉 assembled：每位真人各記一筆 team_joined，並收回這些真人在其他隊伍的未成立提案。
 * 回應 { status: "proposed", pending: [還沒同意的真人 userId] } 或 { status: "assembled", pending: [] }。
 */
export const POST = route(async (_req: Request, ctx: Ctx) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");
  const { id } = await ctx.params;

  const gate = await emailGate(uid);
  if (gate) return apiError(403, gate);

  const team = await prisma.team.findUnique({
    where: { id },
    include: { members: { include: { user: { select: { isBot: true } } } } },
  });
  if (!team || !team.members.some((m) => m.userId === uid))
    return apiError(404, "not found");
  if (team.status === "assembled")
    return NextResponse.json({ status: "assembled", pending: [] });

  // 同一隊的並發加入排隊處理，避免重複轉換狀態／重複記帳
  const release = tryLock(`team:${id}`, 30_000);
  if (!release) return apiError(409, "in_progress");
  try {
    await prisma.teamMember.update({
      where: { teamId_userId: { teamId: id, userId: uid } },
      data: { accepted: true },
    });

    const members = await prisma.teamMember.findMany({
      where: { teamId: id },
      include: { user: { select: { isBot: true } } },
    });
    const humans = members.filter((m) => !m.user.isBot);
    const pending = humans.filter((m) => !m.accepted).map((m) => m.userId);

    if (pending.length > 0) {
      // 還在等其他真人隊友同意：通知他們有邀請
      publish(`team:${id}`, { type: "accepted", userId: uid });
      for (const m of members) publish(`user:${m.userId}`, { type: "refresh" });
      return NextResponse.json({ status: "proposed", pending });
    }

    // 全員同意：只有把 proposed 改成 assembled 的那一個請求負責收尾
    const { count } = await prisma.team.updateMany({
      where: { id, status: "proposed" },
      data: { status: "assembled" },
    });
    if (count === 1) {
      await prisma.teamMember.updateMany({
        where: { teamId: id, userId: { in: members.filter((m) => m.user.isBot).map((m) => m.userId) } },
        data: { accepted: true },
      });

      // 收回這些真人在其他隊伍的未成立提案（一個人只能在一支成立的隊伍）
      const humanIds = humans.map((m) => m.userId);
      const withdrawn = await prisma.team.findMany({
        where: {
          id: { not: id },
          status: "proposed",
          members: { some: { userId: { in: humanIds } } },
        },
        include: { members: { select: { userId: true } } },
      });
      if (withdrawn.length > 0)
        await prisma.team.deleteMany({
          where: { id: { in: withdrawn.map((t) => t.id) }, status: "proposed" },
        });

      // 帳本：每位真人各一筆成隊（值 = 隊伍分數）
      for (const m of humans) await recordLedger(m.userId, "team_joined", team.score, id);

      publish(`team:${id}`, { type: "assembled" });
      const notify = new Set<string>(members.map((m) => m.userId));
      for (const t of withdrawn) for (const m of t.members) notify.add(m.userId);
      for (const u of notify) publish(`user:${u}`, { type: "refresh" });
    }

    return NextResponse.json({ status: "assembled", pending: [] });
  } finally {
    release();
  }
}, "teams/[id] POST");
