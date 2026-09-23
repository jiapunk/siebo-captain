import { prisma } from "./db";
import { publish } from "./bus";
import { rateLimit } from "./rateLimit";
import { HttpError } from "./http";

/**
 * 成本與濫用防護（會呼叫 LLM / Jev 的路由共用）。
 *
 * - throttle()：每人／每 run 節流，超過 → 429 rate_limited（附 retryAfterSec 與 Retry-After）
 * - tryLock()：同一件事同時只跑一次（in-flight 鎖），被占用 → 呼叫端回 409
 * - singleFlight()：同 key 的並發請求共用同一個 Promise（不重複呼叫 LLM、不重複記帳）
 * - reapStaleRuns()：把超過 10 分鐘仍 running 的 run 標成 failed（行程重啟／背景工作崩潰留下的殘骸）
 *
 * 全部是行程內狀態（與 bus、rateLimit 相同）：單機 demo 足夠；多實例部署要換成共享儲存。
 */

/** 各端點的節流額度：[次數, 視窗毫秒] */
export const LIMITS = {
  /** POST /api/matching/run：每人 10 次 / 10 分鐘（每次最多 5 場互盤） */
  matching: [10, 10 * 60_000],
  /** POST /api/teams/assemble：每人 10 次 / 10 分鐘 */
  assemble: [10, 10 * 60_000],
  /** POST /api/compare 真正重跑單體 baseline：每個 run 1 次 / 分鐘 */
  compare: [1, 60_000],
  /** POST /api/onboarding/message：每人 20 則 / 分鐘 */
  onboardingMessage: [20, 60_000],
  /** POST /api/onboarding/compile：每人 5 次 / 10 分鐘 */
  onboardingCompile: [5, 10 * 60_000],
  /** POST /api/people/[id]/icebreakers 新生成：每人 30 張 / 10 分鐘 */
  icebreaker: [30, 10 * 60_000],
  /** 隊伍群聊＋私訊（會觸發模擬隊友的 LLM 回覆）：每人 30 則 / 分鐘 */
  chat: [30, 60_000],
  /** POST /api/connections：每人 30 次 / 10 分鐘 */
  connect: [30, 10 * 60_000],
  /** POST /api/events/join（防猜活動代碼）：每人 10 次 / 10 分鐘 */
  eventJoin: [10, 10 * 60_000],
} as const satisfies Record<string, readonly [number, number]>;

export type LimitName = keyof typeof LIMITS;

/** 超過 run 的合理執行時間仍是 running → 視為卡死 */
export const STALE_RUN_MS = 10 * 60_000;

type GuardState = {
  locks: Map<string, number>;
  flights: Map<string, Promise<unknown>>;
  lastReap: number;
};
const g = globalThis as unknown as { __sd_costGuard?: GuardState };
const state: GuardState =
  g.__sd_costGuard ??
  (g.__sd_costGuard = { locks: new Map(), flights: new Map(), lastReap: 0 });

/** 節流：超過額度直接丟 429 rate_limited（由 http.ts 的 route() 轉成回應） */
export function throttle(name: LimitName, key: string): void {
  const [limit, windowMs] = LIMITS[name];
  const rl = rateLimit(`cost:${name}:${key}`, limit, windowMs);
  if (!rl.ok)
    throw new HttpError(429, "rate_limited", { retryAfterSec: rl.retryAfterSec });
}

/**
 * in-flight 鎖：拿到回傳 release()；已被占用回 null。
 * ttl 是保險絲：就算呼叫端在例外路徑忘了 release，時間到也會自動失效。
 */
export function tryLock(key: string, ttlMs = 5 * 60_000): (() => void) | null {
  const now = Date.now();
  const until = state.locks.get(key);
  if (until !== undefined && until > now) return null;
  const token = now + ttlMs;
  state.locks.set(key, token);
  return () => {
    if (state.locks.get(key) === token) state.locks.delete(key);
  };
}

/** 同 key 的並發呼叫共用同一個 Promise；完成（成功或失敗）後移除 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = state.flights.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      state.flights.delete(key);
    }
  })();
  state.flights.set(key, p);
  return p;
}

/** 這個 key 目前是否有 singleFlight 在跑 */
export function inFlight(key: string): boolean {
  return state.flights.has(key);
}

/**
 * 回收卡死的 run：createdAt 超過 maxAgeMs 仍 running → failed。
 * 會對 run 頻道發 { type: "status", runId, status: "failed" }，讓開著的串流立刻收尾，
 * 並通知雙方的個人頻道 refresh。回傳回收筆數。
 */
export async function reapStaleRuns(maxAgeMs = STALE_RUN_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const stale = await prisma.matchRun.findMany({
    where: { status: "running", createdAt: { lt: cutoff } },
    select: { id: true, userAId: true, userBId: true },
  });
  if (stale.length === 0) return 0;
  const { count } = await prisma.matchRun.updateMany({
    where: { id: { in: stale.map((r) => r.id) }, status: "running" },
    data: { status: "failed" },
  });
  for (const r of stale) {
    publish(`run:${r.id}`, { type: "status", runId: r.id, status: "failed" });
    publish(`user:${r.userAId}`, { type: "refresh" });
    publish(`user:${r.userBId}`, { type: "refresh" });
  }
  if (count > 0) console.warn(`[costGuard] reaped ${count} stale running run(s)`);
  return count;
}

/**
 * 行程內第一次呼叫一定執行（等同「啟動時回收」），之後最多每分鐘一次。
 * 由 matching/run、agent/runs 與 run 串流在讀取 running 狀態前呼叫。
 */
export async function ensureReaped(): Promise<void> {
  const now = Date.now();
  if (now - state.lastReap < 60_000) return;
  state.lastReap = now;
  try {
    await reapStaleRuns();
  } catch (e) {
    console.warn("[costGuard] reapStaleRuns failed", e);
  }
}
