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

      onClose(
        subscribe(`team:${id}`, (data: string) => {
          const evt = JSON.parse(data);
          if (evt.type === "message" || evt.type === "typing") send(evt);
        }),
      );
    },
    { signal: req.signal, key: uid },
  );
}
