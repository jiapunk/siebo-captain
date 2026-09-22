import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { publish } from "@/lib/bus";
import { recordLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const pair = (a: string, b: string) => (a < b ? [a, b] : [b, a]);

/** 我的持續聯絡清單 */
export async function GET() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const gate = await emailGate(uid);
  if (gate) return NextResponse.json({ error: gate }, { status: 403 });

  const conns = await prisma.connection.findMany({
    where: { OR: [{ userAId: uid }, { userBId: uid }] },
    orderBy: { createdAt: "desc" },
    include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const otherIds = conns.map((c) => (c.userAId === uid ? c.userBId : c.userAId));
  const users = await prisma.user.findMany({
    where: { id: { in: otherIds } },
    select: { id: true, name: true, emoji: true, isBot: true },
  });
  const map = new Map(users.map((u) => [u.id, u]));

  return NextResponse.json({
    connections: conns.map((c) => {
      const oid = c.userAId === uid ? c.userBId : c.userAId;
      const u = map.get(oid);
      return {
        id: c.id,
        status: c.status,
        other: {
          id: oid,
          name: u?.name ?? "?",
          emoji: u?.emoji ?? "?",
          isBot: u?.isBot ?? false,
        },
        lastMessage: c.messages[0]
          ? { content: c.messages[0].content, senderId: c.messages[0].senderId }
          : null,
        createdAt: c.createdAt,
      };
    }),
  });
}

/** 發起保持聯絡（模擬對象自動接受） */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { userId } = (await req.json()) as { userId?: string };
  if (!userId || userId === uid)
    return NextResponse.json({ error: "invalid_user" }, { status: 400 });

  const other = await prisma.user.findUnique({ where: { id: userId } });
  if (!other) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [a, b] = pair(uid, userId);
  const status = other.isBot ? "connected" : "requested";

  const conn = await prisma.connection.upsert({
    where: { userAId_userBId: { userAId: a, userBId: b } },
    update: {},
    create: { userAId: a, userBId: b, status },
  });

  if (conn.status === "connected") {
    await recordLedger(uid, "connection", 1, conn.id);
    await recordLedger(userId, "connection", 1, conn.id);
  }

  publish(`user:${uid}`, { type: "refresh" });
  publish(`user:${userId}`, { type: "refresh" });
  return NextResponse.json({ id: conn.id, status: conn.status });
}
