import { getCurrentUserId } from "@/lib/session";
import { sseResponse } from "@/lib/sse";
import { subscribe } from "@/lib/bus";

export const dynamic = "force-dynamic";

/** 訂閱當前用戶的個人事件頻道（配對狀態變更 → 前端刷新） */
export async function GET(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return new Response("unauthorized", { status: 401 });

  return sseResponse(
    ({ send, onClose }) => {
      send({ type: "ready" });
      // 斷線時 sseResponse 一定會呼叫 onClose 的清理 → 退訂，不留 listener
      onClose(
        subscribe(`user:${uid}`, (data: string) => {
          send(JSON.parse(data));
        }),
      );
    },
    { signal: req.signal, key: uid },
  );
}
