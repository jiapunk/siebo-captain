import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { getServerLocale } from "@/lib/locale";
import { publish } from "@/lib/bus";
import { scheduleConnectReply } from "@/lib/connectBot";
import { recordLedger } from "@/lib/ledger";
import { throttle } from "@/lib/costGuard";
import { apiError, readJson, route, str } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 私訊單則上限（超過截斷） */
const MAX_MESSAGE = 2000;

/**
 * 私訊：只有 connected 的聯絡能傳（requested → 423 locked）。
 * 對象是模擬對象時會觸發一次 LLM 回覆 → 每人 30 則 / 分鐘（429 rate_limited）。
 */
export const POST = route(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const uid = await getCurrentUserId();
    if (!uid) return apiError(401, "unauthorized");
    const { id } = await ctx.params;
    const body = await readJson<{ content?: string }>(req);
    const content = str(body.content);
    if (!content) return apiError(400, "content required");

    const gate = await emailGate(uid);
    if (gate) return apiError(403, gate);

    const conn = await prisma.connection.findUnique({ where: { id } });
    if (!conn || (conn.userAId !== uid && conn.userBId !== uid))
      return apiError(404, "not found");
    if (conn.status !== "connected") return apiError(423, "locked");

    throttle("chat", uid);

    const msg = await prisma.connectMessage.create({
      data: { connectionId: id, senderId: uid, content: content.slice(0, MAX_MESSAGE) },
    });
    publish(`connect:${id}`, { type: "message", message: msg });

    const otherId = conn.userAId === uid ? conn.userBId : conn.userAId;
    const [sender, other] = await Promise.all([
      prisma.user.findUnique({ where: { id: uid }, select: { isBot: true } }),
      prisma.user.findUnique({ where: { id: otherId }, select: { isBot: true } }),
    ]);
    if (!sender?.isBot) await recordLedger(uid, "message_sent", 1, id);

    if (other?.isBot) {
      const locale = await getServerLocale();
      scheduleConnectReply(id, uid, locale);
    }

    return NextResponse.json({ message: msg });
  },
  "connections/[id]/messages",
);
