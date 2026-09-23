import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { pollMessages, sseResponse } from "@/lib/sse";
import { subscribe } from "@/lib/bus";

export const dynamic = "force-dynamic";
/** 長連線：平台到時限會切斷，EventSource 會自動重連（重連時 init 會帶完整訊息） */
export const maxDuration = 300;

/**
 * 隊伍群聊串流：init（成員＋完整訊息）之後，即時訊息與打字事件走行程內 bus；
 * 另外每 3 秒輪詢 DB 補送 bus 沒送到的訊息（多實例部署、訂閱前的空窗），以訊息 id 去重。
 * 打字事件只走 bus（多實例時收不到，屬於可遺失的提示）。
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const uid = await getCurrentUserId();
  if (!uid) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;

  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      members: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!team || !team.members.some((m) => m.userId === uid))
    return new Response("not found", { status: 404 });
  if (team.status !== "assembled")
    return new Response("locked", { status: 423 });

  const users = await prisma.user.findMany({
    where: { id: { in: team.members.map((m) => m.userId) } },
    select: { id: true, name: true, emoji: true, isBot: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return sseResponse(
    ({ send, onClose }) => {
      send({
        type: "init",
        me: uid,
        members: team.members.map((m) => {
          const u = userMap.get(m.userId);
          return {
            userId: m.userId,
            name: u?.name ?? "?",
            emoji: u?.emoji ?? "?",
            isBot: u?.isBot ?? false,
            role: m.role,
          };
        }),
        messages: team.messages,
      });

      const offer = pollMessages(
        { onClose },
        {
          initial: team.messages,
          fetchSince: (since) =>
            prisma.teamMessage.findMany({
              where: { teamId: id, createdAt: { gte: since } },
              orderBy: { createdAt: "asc" },
            }),
          onNew: (message) => send({ type: "message", message }),
        },
      );
      onClose(
        subscribe(`team:${id}`, (data: string) => {
          const evt = JSON.parse(data);
          if (evt.type === "message" && evt.message) offer(evt.message);
          else if (evt.type === "typing") send(evt);
        }),
      );
    },
    { signal: req.signal, key: uid },
  );
}
