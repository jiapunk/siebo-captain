import { prisma } from "@/lib/db";
import { subscribe } from "@/lib/bus";
import { sseResponse } from "@/lib/sse";
import type { RunEvent } from "@/lib/types";

/**
 * 互盤逐字稿串流的共用實作（單 run 舊路由與多工路由共用）。
 * 呼叫前必須已驗證 uid 是每個 run 的 A 或 B。
 *
 * 事件格式（每則 `data:` 都是 JSON）：
 *   { type: "event", runId, seq, event: RunEvent }  歷史事件先補完，之後即時；seq = 該事件在 run.events 的索引，
 *                                                   用戶端可用 (runId, seq) 去重
 *   { type: "ready", runId, status }                該 run 的歷史已補完（status: running | completed | failed）
 *   { type: "run_closed", runId, status }           該 run 結束（收到 done 事件、狀態已非 running，或 run 已被刪除 → "missing"）
 *   { type: "closed" }                              全部 run 都結束，伺服器關閉串流
 *   `: ping` 註解每 25 秒一次（心跳）
 *
 * 即時事件走行程內 bus；另外每 POLL_MS 輪詢 DB 補送漏掉的事件（訂閱前的空窗、多實例部署時 bus 不相通）。
 */

export const MAX_STREAM_RUNS = 8;
const POLL_MS = 3000;

type Tracker = {
  seen: Set<string>;
  doneSeen: boolean;
  finished: boolean;
  /** 已看到非 running 狀態但還沒收到 done 事件的輪詢次數 */
  settledPolls: number;
};

type BusMsg = { type?: string; event?: RunEvent; status?: string };

export function runsStream(
  uid: string,
  runIds: string[],
  signal?: AbortSignal,
): Response {
  return sseResponse(
    async ({ send, close, onClose }) => {
      const trackers = new Map<string, Tracker>(
        runIds.map((id) => [
          id,
          { seen: new Set(), doneSeen: false, finished: false, settledPolls: 0 },
        ]),
      );
      let stopped = false;
      onClose(() => {
        stopped = true;
      });

      const allFinished = () =>
        Array.from(trackers.values()).every((t) => t.finished);

      const finish = (runId: string, status: string) => {
        const t = trackers.get(runId);
        if (!t || t.finished) return;
        t.finished = true;
        send({ type: "run_closed", runId, status });
        if (allFinished()) {
          send({ type: "closed" });
          close();
        }
      };

      /** 送出一個事件（已送過的略過）；seq 未知時用「目前已送出數」= 下一個索引 */
      const emit = (runId: string, ev: RunEvent, seq?: number) => {
        const t = trackers.get(runId);
        if (!t || t.finished) return;
        const k = JSON.stringify(ev);
        if (t.seen.has(k)) return;
        const s = seq ?? t.seen.size;
        t.seen.add(k);
        send({ type: "event", runId, seq: s, event: ev });
        if (ev.type === "done") t.doneSeen = true;
      };

      /** 讀 DB：補送沒送過的事件，並依狀態判斷是否結束 */
      const syncFromDb = async (ids: string[], initial: boolean) => {
        const rows = await prisma.matchRun.findMany({
          where: { id: { in: ids } },
          select: { id: true, status: true, events: true },
        });
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const id of ids) {
          if (stopped) return;
          const row = byId.get(id);
          if (!row) {
            finish(id, "missing");
            continue;
          }
          const events = Array.isArray(row.events)
            ? (row.events as unknown as RunEvent[])
            : [];
          events.forEach((ev, i) => emit(id, ev, i));
          if (initial) send({ type: "ready", runId: id, status: row.status });
          const t = trackers.get(id)!;
          if (row.status !== "running") {
            // done 事件在狀態更新之後才寫入：初次讀取或已收到 done 就結束，否則多等一輪輪詢
            if (initial || t.doneSeen || ++t.settledPolls >= 2) finish(id, row.status);
          }
        }
      };

      // 1) 先訂閱（初次讀 DB 前到的即時事件先暫存），避免「讀完歷史 → 訂閱」之間漏事件
      let live = false;
      const pending: Array<[string, BusMsg]> = [];
      const handle = (runId: string, msg: BusMsg) => {
        if (msg.type === "event" && msg.event) {
          emit(runId, msg.event);
          if (msg.event.type === "done") {
            // done 之前 runPair 已寫入最終狀態
            void prisma.matchRun
              .findUnique({ where: { id: runId }, select: { status: true } })
              .then((r) => finish(runId, r?.status ?? "missing"))
              .catch(() => finish(runId, "completed"));
          }
        } else if (msg.type === "status" && msg.status && msg.status !== "running") {
          // costGuard.reapStaleRuns 回收卡死的 run
          finish(runId, msg.status);
        }
      };
      for (const id of runIds) {
        onClose(
          subscribe(`run:${id}`, (data: string) => {
            let msg: BusMsg;
            try {
              msg = JSON.parse(data) as BusMsg;
            } catch {
              return;
            }
            if (live) handle(id, msg);
            else pending.push([id, msg]);
          }),
        );
      }

      // 2) 補歷史 + ready
      await syncFromDb(runIds, true);
      if (stopped) return;
      live = true;
      for (const [id, msg] of pending.splice(0)) handle(id, msg);
      if (stopped || allFinished()) return;

      // 3) 輪詢補送（bus 不相通或漏訊時的保險）；串流關閉時停止
      let polling = false;
      const timer = setInterval(() => {
        if (stopped || polling) return;
        const open = runIds.filter((id) => !trackers.get(id)?.finished);
        if (open.length === 0) return;
        polling = true;
        syncFromDb(open, false)
          .catch((e) => console.warn("run stream poll failed", e))
          .finally(() => {
            polling = false;
          });
      }, POLL_MS);
      onClose(() => clearInterval(timer));
    },
    { signal, key: uid },
  );
}
