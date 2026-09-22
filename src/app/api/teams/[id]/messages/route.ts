import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { publish } from "@/lib/bus";
import { scheduleTeamReply } from "@/lib/teamBot";
import { recordLedger } from "@/lib/ledger";
import { getServerLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { content } = (await req.json()) as { content?: string };
  if (!content?.trim())
    return NextResponse.json({ error: "content required" }, { status: 400 });

  const team = await prisma.team.findUnique({
    where: { id },
    include: { members: true },
  });
  if (!team || !team.members.some((m) => m.userId === uid))
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (team.status !== "assembled")
    return NextResponse.json({ error: "locked" }, { status: 423 });

  const msg = await prisma.teamMessage.create({
    data: { teamId: id, senderId: uid, content: content.trim().slice(0, 2000) },
  });
  publish(`team:${id}`, { type: "message", message: msg });

  const sender = await prisma.user.findUnique({
    where: { id: uid },
    select: { isBot: true },
  });
  if (!sender?.isBot) await recordLedger(uid, "message_sent", 1, id);

  // 模擬隊友輪流回話
  const others = team.members.filter((m) => m.userId !== uid);
  if (others.length > 0) {
    const locale = await getServerLocale();
    scheduleTeamReply(id, uid, locale);
  }

  return NextResponse.json({ message: msg });
}
