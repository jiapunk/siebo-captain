import { prisma } from "./db";
import { publish } from "./bus";
import { clientKey, rateLimit } from "./rateLimit";
import { HttpError } from "./http";

/**
 * 成本與濫用防護（會呼叫 LLM / Jev 的路由共用）。
 *
 * - throttle()：三層節流，任一層超過 → 429 rate_limited（附 retryAfterSec、scope 與 Retry-After）
 *     1. 每人／每 run（LIMITS）
 *     2. 每來源（SHARED_LIMITS.source，key = clientKey(req)；只在 TRUST_PROXY=1 能分出 IP 時生效，
 *        直連時所有人本來就同一桶，交給第 3 層）
 *     3. 全站合計（SHARED_LIMITS.global）：示範身分可以一直開新的，每人額度擋不住總量，這層把 LLM 呼叫總量封頂
 *   共用層先「只看不記」，全部通過才記帳：被擋的請求不會吃掉別人的共用額度。
 *   COST_BUDGET_SCALE=<倍數> 可整體放大／縮小第 2、3 層；COST_BUDGET_SCALE=off 關掉第 2、3 層（每人額度仍在）。
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

type Rule = readonly [number, number];

/**
 * 會呼叫 LLM／Jev 的端點的共用預算（全部 10 分鐘視窗）：source = 每來源、global = 全站合計。
 * 聯絡、加入活動不呼叫 LLM，只有每人額度。
 */
export const SHARED_LIMITS = {
  /** 每次最多 5 場互盤 */
  matching: { source: [60, 10 * 60_000], global: [120, 10 * 60_000] },
  /** 每次最多 15 次隔離評估 */
  assemble: { source: [60, 10 * 60_000], global: [120, 10 * 60_000] },
  /** 只算真正重跑單體 baseline 的請求 */
  compare: { source: [60, 10 * 60_000], global: [120, 10 * 60_000] },
  onboardingMessage: { source: [400, 10 * 60_000], global: [800, 10 * 60_000] },
  onboardingCompile: { source: [60, 10 * 60_000], global: [120, 10 * 60_000] },
  icebreaker: { source: [200, 10 * 60_000], global: [400, 10 * 60_000] },
  /** 只在對話裡有模擬隊友（會觸發 LLM 回覆）時才有意義，但一律計入 */
  chat: { source: [400, 10 * 60_000], global: [800, 10 * 60_000] },
} as const satisfies Partial<Record<LimitName, { source: Rule; global: Rule }>>;

/** 超過 run 的合理執行時間仍是 running → 視為卡死 */
export const STALE_RUN_MS = 10 * 60_000;

type GuardState = {
  locks: Map<string, number>;
  flights: Map<string, Promise<unknown>>;
  lastReap: number;
  /** 共用預算的滑動窗（key → 命中時間戳，舊到新） */
  budgets?: Map<string, number[]>;
  lastBudgetSweep?: number;
};
const g = globalThis as unknown as { __sd_costGuard?: GuardState };
const state: GuardState =
  g.__sd_costGuard ??
  (g.__sd_costGuard = { locks: new Map(), flights: new Map(), lastReap: 0 });
// dev HMR：舊版 state 沒有 budgets 欄位
const budgets: Map<string, number[]> = (state.budgets ??= new Map());

/** 共用預算最多追蹤幾個 key（TRUST_PROXY=1 時每個 IP 一個）；超過從最久沒動的開始丟 */
const MAX_BUDGET_KEYS = 10_000;
const BUDGET_SWEEP_MS = 60_000;

/** COST_BUDGET_SCALE：未設 → 1；off → 關閉共用層；正數 → 倍數；其他值 → 1 */
function budgetScale(): number | null {
  const raw = process.env.COST_BUDGET_SCALE?.trim().toLowerCase();
  if (!raw) return 1;
  if (raw === "off") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function sweepBudgets(now: number) {
  for (const [k, hits] of budgets) {
    const newest = hits[hits.length - 1];
    // 所有共用視窗都是 10 分鐘
    if (newest === undefined || now - newest >= 10 * 60_000) budgets.delete(k);
  }
  if (budgets.size > MAX_BUDGET_KEYS) {
    let excess = budgets.size - MAX_BUDGET_KEYS;
    for (const k of budgets.keys()) {
      if (excess-- <= 0) break;
      budgets.delete(k);
    }
  }
  state.lastBudgetSweep = now;
}

/**
 * 節流：超過額度直接丟 429 rate_limited（由 http.ts 的 route() 轉成回應）。
 * - key：每人／每 run 的鍵（通常是 uid）
 * - req：有給才會套用「每來源」預算；「全站」預算不需要 req，一律套用
 * 429 回應附 scope："user"（每人／每 run）、"source"（每來源）、"global"（全站）。
 */
export function throttle(name: LimitName, key: string, req?: Request): void {
  const now = Date.now();

  // 1) 共用層：只看不記（被擋時不消耗任何額度）
  const buckets = sharedBuckets(name, req);
  const pending: Array<[string, number[]]> = [];
  for (const b of buckets) {
    const hits = (budgets.get(b.key) ?? []).filter((t) => now - t < b.windowMs);
    if (hits.length >= b.limit) {
      budgets.set(b.key, hits);
      const retryAfterSec = Math.max(1, Math.ceil((b.windowMs - (now - hits[0])) / 1000));
      throw new HttpError(429, "rate_limited", { retryAfterSec, scope: b.scope });
    }
    pending.push([b.key, hits]);
  }

  // 2) 每人／每 run（通過才會記一次）
  const [limit, windowMs] = LIMITS[name];
  const rl = rateLimit(`cost:${name}:${key}`, limit, windowMs);
  if (!rl.ok)
    throw new HttpError(429, "rate_limited", {
      retryAfterSec: rl.retryAfterSec,
      scope: "user",
    });

  // 3) 全部通過 → 共用層記帳（delete + set：活躍的 key 移到尾端，超量清除時先丟最久沒動的）
  for (const [k, hits] of pending) {
    hits.push(now);
    budgets.delete(k);
    budgets.set(k, hits);
  }
}

type Bucket = { key: string; limit: number; windowMs: number; scope: "source" | "global" };

/** 這次請求要檢查的共用桶（沒有共用預算、或 COST_BUDGET_SCALE=off → 空陣列） */
function sharedBuckets(name: LimitName, req?: Request): Bucket[] {
  const shared = (SHARED_LIMITS as Partial<Record<LimitName, { source: Rule; global: Rule }>>)[name];
  const scale = budgetScale();
  if (!shared || scale === null) return [];
  const now = Date.now();
  if (now - (state.lastBudgetSweep ?? 0) > BUDGET_SWEEP_MS) sweepBudgets(now);
  const scaled = ([n, w]: Rule) => ({ limit: Math.max(1, Math.floor(n * scale)), windowMs: w });
  const out: Bucket[] = [];
  // 直連時 clientKey 一律是 "direct"（大家同一桶），等同全站層，不重複計
  const src = req ? clientKey(req) : "direct";
  if (src !== "direct")
    out.push({ key: `src:${name}:${src}`, scope: "source", ...scaled(shared.source) });
  out.push({ key: `global:${name}`, scope: "global", ...scaled(shared.global) });
  return out;
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
