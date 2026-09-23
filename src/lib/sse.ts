/**
 * SSE Response 工廠：心跳 + 保證收尾。
 *
 * 串流在以下任一情況都會「一次且只一次」執行 cleanup：
 *   - 用戶端斷線（ReadableStream.cancel()，或傳入的 req.signal abort）
 *   - 伺服器端呼叫 close()
 *   - enqueue 失敗（連線已斷）
 * cleanup 會清掉心跳 interval、執行所有 onClose 註冊的清理（例如 bus 退訂）、abort ctx.signal、關閉串流。
 *
 * 另外有同時連線上限：每個 key（通常是 uid）最多 MAX_STREAMS_PER_KEY 條、全行程最多 MAX_STREAMS_TOTAL 條，
 * 超過回 429 / 503 { error: "too_many_streams" }。
 */

export interface SseContext {
  /** 送出一則 `data:` 事件（JSON）；串流已關閉時靜默忽略 */
  send: (obj: unknown) => void;
  /** 串流關閉時 abort（可交給 fetch / DB 查詢等可取消的工作） */
  signal: AbortSignal;
  /** 伺服器端主動結束串流 */
  close: () => void;
  /** 註冊關閉時的清理（例如 bus 退訂）；若串流已關閉會立即執行 */
  onClose: (fn: () => void) => void;
}

export interface SseOptions {
  /** 傳入 route handler 的 req.signal：用戶端斷線時一定收尾 */
  signal?: AbortSignal;
  /** 同時連線上限的計數鍵（通常是 uid）；不給就只算全行程上限 */
  key?: string;
  /** 心跳間隔（預設 25 秒） */
  heartbeatMs?: number;
}

export const MAX_STREAMS_PER_KEY = 24;
export const MAX_STREAMS_TOTAL = 1000;

type Counter = { total: number; perKey: Map<string, number> };
const g = globalThis as unknown as { __sd_sse?: Counter };
const counter: Counter = g.__sd_sse ?? (g.__sd_sse = { total: 0, perKey: new Map() });

/** 目前開著的串流數（診斷／測試用） */
export function sseStats(): { total: number; perKey: Record<string, number> } {
  return { total: counter.total, perKey: Object.fromEntries(counter.perKey) };
}

function jsonError(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export function sseResponse(
  setup: (ctx: SseContext) => void | Promise<void>,
  opts: SseOptions = {},
): Response {
  const key = opts.key;
  if (counter.total >= MAX_STREAMS_TOTAL) return jsonError(503, "too_many_streams");
  if (key && (counter.perKey.get(key) ?? 0) >= MAX_STREAMS_PER_KEY)
    return jsonError(429, "too_many_streams");
  // 用戶端在我們準備好之前就斷了：不必開串流
  if (opts.signal?.aborted) return new Response(null, { status: 204 });

  counter.total++;
  if (key) counter.perKey.set(key, (counter.perKey.get(key) ?? 0) + 1);

  const encoder = new TextEncoder();
  const ac = new AbortController();
  const closers: Array<() => void> = [];
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    opts.signal?.removeEventListener("abort", cleanup);
    counter.total = Math.max(0, counter.total - 1);
    if (key) {
      const n = (counter.perKey.get(key) ?? 1) - 1;
      if (n <= 0) counter.perKey.delete(key);
      else counter.perKey.set(key, n);
    }
    for (const fn of closers.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.error("SSE cleanup error", e);
      }
    }
    ac.abort();
    try {
      ctrl?.close();
    } catch {}
  };

  const onClose = (fn: () => void) => {
    if (closed) {
      try {
        fn();
      } catch (e) {
        console.error("SSE cleanup error", e);
      }
      return;
    }
    closers.push(fn);
  };

  const send = (obj: unknown) => {
    if (closed || !ctrl) return;
    try {
      ctrl.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
    } catch {
      cleanup();
    }
  };

  opts.signal?.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, opts.heartbeatMs ?? 25_000);
      // setup 在背景跑（start 立即返回）；setup 失敗就收掉串流，不留半開的連線
      Promise.resolve()
        .then(() => setup({ send, signal: ac.signal, close: cleanup, onClose }))
        .catch((e) => {
          console.error("SSE setup error", e);
          cleanup();
        });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
