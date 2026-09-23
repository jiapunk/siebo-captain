import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { pollMessages, sseResponse } from "@/lib/sse";
import { subscribe } from "@/lib/bus";

export const dynamic = "force-dynamic";
/** 長連線：平台到時限會切斷，EventSource 會自動重連（重連時 init 會帶完整訊息） */
export const maxDuration = 300;

/**
 * 私訊串流：init（對方＋完整訊息）之後，即時訊息與打字事件走行程內 bus；
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

  const conn = await prisma.connection.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conn || (conn.userAId !== uid && conn.userBId !== uid))
    return new Response("not found", { status: 404 });
  if (conn.status !== "connected") return new Response("locked", { status: 423 });

  const otherId = conn.userAId === uid ? conn.userBId : conn.userAId;
  const other = await prisma.user.findUnique({
    where: { id: otherId },
    select: { name: true, emoji: true },
  });

  return sseResponse(
    ({ send, onClose }) => {
      send({
        type: "init",
        me: uid,
        other: { id: otherId, name: other?.name, emoji: other?.emoji },
        messages: conn.messages,
      });
      const offer = pollMessages(
        { onClose },
        {
          initial: conn.messages,
          fetchSince: (since) =>
            prisma.connectMessage.findMany({
              where: { connectionId: id, createdAt: { gte: since } },
              orderBy: { createdAt: "asc" },
            }),
          onNew: (message) => send({ type: "message", message }),
        },
      );
      onClose(
        subscribe(`connect:${id}`, (data: string) => {
          const evt = JSON.parse(data);
          if (evt.type === "message" && evt.message) offer(evt.message);
          else if (evt.type === "typing") send(evt);
        }),
      );
    },
    { signal: req.signal, key: uid },
  );
}
