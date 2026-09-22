import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { sseResponse } from "@/lib/sse";
import { subscribe } from "@/lib/bus";
import type { RunEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const uid = await getCurrentUserId();
  if (!uid) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;

  const run = await prisma.matchRun.findUnique({ where: { id } });
  if (!run || (run.userAId !== uid && run.userBId !== uid))
    return new Response("not found", { status: 404 });

  // 歷史事件一次補完，之後 live 訂閱
  const past = ((run.events as unknown as RunEvent[]) ?? []).slice();

  return sseResponse((send, signal) => {
    for (const e of past) send({ type: "event", event: e });
    send({ type: "ready", status: run.status });
    if (run.status !== "running") {
      send({ type: "closed" });
      return;
    }
    const unsub = subscribe(`run:${id}`, (data) => {
      send(JSON.parse(data));
      const parsed = JSON.parse(data) as { type: string; event?: RunEvent };
      if (parsed.type === "event" && parsed.event?.type === "done") {
        unsub();
        send({ type: "closed" });
        signal.dispatchEvent(new Event("abort"));
      }
    });
    signal.addEventListener("abort", unsub);
  });
}
