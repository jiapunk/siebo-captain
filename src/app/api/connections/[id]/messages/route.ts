import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { getServerLocale } from "@/lib/locale";
import { publish } from "@/lib/bus";
import { scheduleConnectReply } from "@/lib/connectBot";
import { recordLedger } from "@/lib/ledger";

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

  const conn = await prisma.connection.findUnique({ where: { id } });
  if (!conn || (conn.userAId !== uid && conn.userBId !== uid))
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (conn.status !== "connected")
    return NextResponse.json({ error: "locked" }, { status: 423 });

  const msg = await prisma.connectMessage.create({
    data: { connectionId: id, senderId: uid, content: content.trim().slice(0, 2000) },
  });
  publish(`connect:${id}`, { type: "message", message: msg });

  const sender = await prisma.user.findUnique({
    where: { id: uid },
    select: { isBot: true },
  });
  if (!sender?.isBot) await recordLedger(uid, "message_sent", 1, id);

  const otherId = conn.userAId === uid ? conn.userBId : conn.userAId;
  const other = await prisma.user.findUnique({
    where: { id: otherId },
    select: { isBot: true },
  });
  if (other?.isBot) {
    const locale = await getServerLocale();
    scheduleConnectReply(id, uid, locale);
  }

  return NextResponse.json({ message: msg });
}
