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

/** 聊天串流輪詢 DB 的間隔 */
export const MESSAGE_POLL_MS = 3000;
/** 每次輪詢往回看多久（涵蓋「先取 createdAt、晚一點才 commit」與多實例間的時鐘誤差） */
const MESSAGE_LOOKBACK_MS = 10_000;

type Row = { id: string; createdAt: Date | string };

/**
 * 聊天串流（隊伍群聊、私訊）的訊息補送：即時訊息走行程內 bus；另外每 MESSAGE_POLL_MS 輪詢 DB，
 * 把 bus 沒送到的訊息補上（訂閱前的空窗、多實例部署時 bus 不相通）。以訊息 id 去重，同一則只送一次。
 *
 * - initial：init 事件已送出的訊息（標成已送）
 * - fetchSince(since)：讀 createdAt ≥ since 的訊息（依 createdAt 升冪；欄位要和 bus 發的 message 相同）
 * - onNew(row)：送出一則新訊息（bus 或輪詢都走這裡）
 * 回傳 offer(row)：bus 收到 message 時呼叫；沒送過才會轉給 onNew。
 * 串流關閉（ctx.onClose）時自動停止輪詢。
 */
export function pollMessages<T extends Row>(
  ctx: Pick<SseContext, "onClose">,
  opts: {
    initial: T[];
    fetchSince: (since: Date) => Promise<T[]>;
    onNew: (row: T) => void;
  },
): (row: T) => void {
  const ms = (r: Row) => new Date(r.createdAt).getTime();
  /** 已送出的 id → createdAt（ms）；只留 lookback 視窗內的，避免長聊天室的 Set 無限長大 */
  const sent = new Map<string, number>();
  let cursor = Date.now();
  let stopped = false;

  const prune = () => {
    const floor = cursor - 2 * MESSAGE_LOOKBACK_MS;
    for (const [id, t] of sent) if (t < floor) sent.delete(id);
  };
  const offer = (row: T) => {
    if (stopped || sent.has(row.id)) return;
    const t = ms(row);
    sent.set(row.id, Number.isFinite(t) ? t : Date.now());
    if (Number.isFinite(t) && t > cursor) cursor = t;
    opts.onNew(row);
  };

  for (const row of opts.initial) {
    const t = ms(row);
    sent.set(row.id, Number.isFinite(t) ? t : Date.now());
    if (Number.isFinite(t) && t > cursor) cursor = t;
  }
  prune();

  let polling = false;
  const timer = setInterval(() => {
    if (stopped || polling) return;
    polling = true;
    opts
      .fetchSince(new Date(cursor - MESSAGE_LOOKBACK_MS))
      .then((rows) => {
        for (const row of rows) offer(row);
        prune();
      })
      .catch((e) => console.warn("message stream poll failed", e))
      .finally(() => {
        polling = false;
      });
  }, MESSAGE_POLL_MS);
  ctx.onClose(() => {
    stopped = true;
    clearInterval(timer);
  });
  return offer;
}
