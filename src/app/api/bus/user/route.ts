import { getCurrentUserId } from "@/lib/session";
import { sseResponse } from "@/lib/sse";
import { subscribe } from "@/lib/bus";

export const dynamic = "force-dynamic";

/** 訂閱當前用戶的個人事件頻道（配對狀態變更 → 前端刷新） */
export async function GET() {
  const uid = await getCurrentUserId();
  if (!uid) return new Response("unauthorized", { status: 401 });

  return sseResponse(async (send, signal) => {
    send({ type: "ready" });
    const unsub = subscribe(`user:${uid}`, (data: string) => {
      send(JSON.parse(data));
    });
    signal.addEventListener("abort", unsub);
  });
}
