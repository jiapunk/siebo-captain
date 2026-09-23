import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { apiError, route } from "@/lib/http";
import { acceptConnection } from "../../connectionState";

export const dynamic = "force-dynamic";

/**
 * 接受聯絡邀請：只有被邀請者能接受。
 * - 200 { id, status: "connected" }（已是 connected 也回 200，冪等）
 * - 403 not_invitee：你是發起者（要等對方接受）
 * - 404 not_found：聯絡不存在或你不是當事人
 */
export const POST = route(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const uid = await getCurrentUserId();
    if (!uid) return apiError(401, "unauthorized");
    const { id } = await ctx.params;

    const gate = await emailGate(uid);
    if (gate) return apiError(403, gate);

    const conn = await prisma.connection.findUnique({ where: { id } });
    if (!conn || (conn.userAId !== uid && conn.userBId !== uid))
      return apiError(404, "not_found");
    if (conn.status === "connected")
      return NextResponse.json({ id: conn.id, status: "connected" });
    if (conn.userBId !== uid) return apiError(403, "not_invitee");

    await acceptConnection(conn.id, conn.userAId, conn.userBId);
    return NextResponse.json({ id: conn.id, status: "connected" });
  },
  "connections/[id]/accept",
);
