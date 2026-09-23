import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { apiError, route } from "@/lib/http";
import { directionOf } from "../connectionState";

export const dynamic = "force-dynamic";

/**
 * 單一聯絡的狀態（非串流；connect 頁在 SSE 失敗時用這個判斷 locked，不要再 fetch 串流本身）。
 * 回應 { id, status, direction, other }；不是當事人 → 404 not_found。
 */
export const GET = route(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const uid = await getCurrentUserId();
    if (!uid) return apiError(401, "unauthorized");
    const { id } = await ctx.params;

    const conn = await prisma.connection.findUnique({ where: { id } });
    if (!conn || (conn.userAId !== uid && conn.userBId !== uid))
      return apiError(404, "not_found");

    const otherId = conn.userAId === uid ? conn.userBId : conn.userAId;
    const other = await prisma.user.findUnique({
      where: { id: otherId },
      select: { id: true, name: true, emoji: true, isBot: true },
    });
    return NextResponse.json({
      id: conn.id,
      status: conn.status,
      direction: directionOf(conn, uid),
      other: {
        id: otherId,
        name: other?.name ?? "?",
        emoji: other?.emoji ?? "?",
        isBot: other?.isBot ?? false,
      },
    });
  },
  "connections/[id] GET",
);
