import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { publish } from "@/lib/bus";
import { scheduleTeamReply } from "@/lib/teamBot";
import { recordLedger } from "@/lib/ledger";
import { getServerLocale } from "@/lib/locale";
import { throttle } from "@/lib/costGuard";
import { apiError, readJson, route, str } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 群聊單則上限（超過截斷） */
const MAX_MESSAGE = 2000;

/**
 * 隊伍群聊：只有已成立（assembled）的隊伍能傳（proposed → 423 locked）。
 * 有模擬隊友時會觸發一次 LLM 回覆 → 每人 30 則 / 分鐘（429 rate_limited）。
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

    const team = await prisma.team.findUnique({
      where: { id },
      include: { members: { include: { user: { select: { isBot: true } } } } },
    });
    if (!team || !team.members.some((m) => m.userId === uid))
      return apiError(404, "not found");
    if (team.status !== "assembled") return apiError(423, "locked");

    throttle("chat", uid);

    const msg = await prisma.teamMessage.create({
      data: { teamId: id, senderId: uid, content: content.slice(0, MAX_MESSAGE) },
    });
    publish(`team:${id}`, { type: "message", message: msg });

    const me = team.members.find((m) => m.userId === uid);
    if (!me?.user.isBot) await recordLedger(uid, "message_sent", 1, id);

    // 模擬隊友輪流回話（純真人隊伍不呼叫 LLM）
    if (team.members.some((m) => m.userId !== uid && m.user.isBot)) {
      const locale = await getServerLocale();
      scheduleTeamReply(id, uid, locale);
    }

    return NextResponse.json({ message: msg });
  },
  "teams/[id]/messages",
);
