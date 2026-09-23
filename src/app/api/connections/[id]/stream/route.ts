import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { sseResponse } from "@/lib/sse";
import { subscribe } from "@/lib/bus";

export const dynamic = "force-dynamic";

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
      onClose(
        subscribe(`connect:${id}`, (data: string) => {
          const evt = JSON.parse(data);
          if (evt.type === "message" || evt.type === "typing") send(evt);
        }),
      );
    },
    { signal: req.signal, key: uid },
  );
}
