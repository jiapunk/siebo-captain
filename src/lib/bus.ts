import { EventEmitter } from "events";

/**
 * 行程內事件匯流排（SSE 的即時來源）。
 * 單機 demo 足夠；多實例部署時各實例互不相通 —— run 串流另外有輪詢 DB 補送，
 * 隊伍／私訊串流則需要換成共享 pub/sub（Redis、Postgres LISTEN/NOTIFY 等）。
 */
const g = globalThis as unknown as { __sd_bus?: EventEmitter };

export const bus: EventEmitter =
  g.__sd_bus ?? (g.__sd_bus = new EventEmitter().setMaxListeners(200));

export function publish(channel: string, event: unknown) {
  bus.emit(channel, JSON.stringify(event));
}

/** 訂閱頻道；回傳退訂函式（SSE 路由要交給 sseResponse 的 onClose，斷線時一定會退訂） */
export function subscribe(
  channel: string,
  listener: (data: string) => void,
): () => void {
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}

/** 頻道目前的訂閱數（診斷／測試用） */
export function listenerCount(channel: string): number {
  return bus.listenerCount(channel);
}
