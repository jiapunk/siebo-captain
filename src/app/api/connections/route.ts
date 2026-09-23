import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { publish } from "@/lib/bus";
import { recordLedger } from "@/lib/ledger";
import { throttle, tryLock } from "@/lib/costGuard";
import { apiError, isId, readJson, route } from "@/lib/http";
import { acceptConnection, directionOf } from "./connectionState";

export const dynamic = "force-dynamic";

/** 我的持續聯絡清單（含等待中的邀請） */
export const GET = route(async () => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");

  const gate = await emailGate(uid);
  if (gate) return apiError(403, gate);

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

  const connections = conns.map((c) => {
    const oid = c.userAId === uid ? c.userBId : c.userAId;
    const u = map.get(oid);
    return {
      id: c.id,
      status: c.status,
      direction: directionOf(c, uid),
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
  });

  return NextResponse.json({
    connections,
    incoming: connections.filter((c) => c.direction === "incoming"),
    outgoing: connections.filter((c) => c.direction === "outgoing"),
  });
}, "connections GET");

/**
 * 發起保持聯絡：body { userId }
 * 回應 { id, status, direction, created }；重複發起不會產生重複資料，也不會重複記帳。
 * - 400 invalid_user；404 not_found；403 not_same_event（雙方沒有共同活動）；409 in_progress；429 rate_limited
 */
export const POST = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");

  const gate = await emailGate(uid);
  if (gate) return apiError(403, gate);

  const { userId } = await readJson<{ userId?: string }>(req);
  if (!isId(userId) || userId === uid) return apiError(400, "invalid_user");

  const other = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isBot: true },
  });
  if (!other) return apiError(404, "not_found");

  // 只能聯絡同一場活動的人（模擬隊友也一樣）：沒有共同活動 → 403 not_same_event
  const shared = await prisma.eventMember.findFirst({
    where: { userId: uid, event: { members: { some: { userId } } } },
    select: { id: true },
  });
  if (!shared) return apiError(403, "not_same_event");

  const pairKey = uid < userId ? `${uid}|${userId}` : `${userId}|${uid}`;
  const release = tryLock(`connect:${pairKey}`, 30_000);
  if (!release) return apiError(409, "in_progress");
  try {
    const existing = await prisma.connection.findFirst({
      where: {
        OR: [
          { userAId: uid, userBId: userId },
          { userAId: userId, userBId: uid },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    if (existing) {
      // 對方先邀請了我：我也按「保持聯絡」＝接受；對 bot 的舊 requested 列也直接升級
      if (
        existing.status === "requested" &&
        (existing.userBId === uid || other.isBot)
      ) {
        await acceptConnection(existing.id, existing.userAId, existing.userBId);
        return NextResponse.json({
          id: existing.id,
          status: "connected",
          direction: null,
          created: false,
        });
      }
      return NextResponse.json({
        id: existing.id,
        status: existing.status,
        direction: directionOf(existing, uid),
        created: false,
      });
    }

    throttle("connect", uid);
    const status = other.isBot ? "connected" : "requested";
    const conn = await prisma.connection.create({
      data: { userAId: uid, userBId: userId, status },
    });
    if (status === "connected") {
      await recordLedger(uid, "connection", 1, conn.id);
      await recordLedger(userId, "connection", 1, conn.id);
    }

    publish(`user:${uid}`, { type: "refresh" });
    publish(`user:${userId}`, { type: "refresh" });
    return NextResponse.json({
      id: conn.id,
      status: conn.status,
      direction: directionOf(conn, uid),
      created: true,
    });
  } finally {
    release();
  }
}, "connections POST");
