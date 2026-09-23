import { NextResponse } from "next/server";

/**
 * 極簡記憶體滑動窗節流（單實例 demo 足夠；多實例/serverless 下各實例各算各的，正式版應換 Redis/Upstash）。
 * - 每個 key 記住自己的 windowMs，定期清掃「整個窗都過期」的 key，Map 不會無限成長
 * - 另設 key 數上限，超過時從最舊的開始丟（寧可少擋，也不讓記憶體被灌爆）
 */
interface Bucket {
  hits: number[];
  windowMs: number;
}

const SWEEP_EVERY_MS = 60_000;
const MAX_KEYS = 20_000;

// 用新的 global key：舊版 __rl 存的是 number[]，dev HMR 時形狀不同
interface LimiterState {
  store: Map<string, Bucket>;
  lastSweep: number;
}
const g = globalThis as unknown as { __rl2?: LimiterState };
const state: LimiterState =
  g.__rl2 ?? (g.__rl2 = { store: new Map<string, Bucket>(), lastSweep: Date.now() });
const store = state.store;

/** 清除過期項目（整個窗都過期的 key 直接刪掉）；超過上限時從最舊的 key 開始丟 */
export function sweepExpired(now = Date.now()) {
  for (const [key, b] of store) {
    const newest = b.hits[b.hits.length - 1];
    if (newest === undefined || now - newest >= b.windowMs) store.delete(key);
  }
  if (store.size > MAX_KEYS) {
    let excess = store.size - MAX_KEYS;
    for (const key of store.keys()) {
      if (excess-- <= 0) break;
      store.delete(key);
    }
  }
  state.lastSweep = now;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (now - state.lastSweep > SWEEP_EVERY_MS || store.size > MAX_KEYS) sweepExpired(now);

  const hits = (store.get(key)?.hits ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    const retry = Math.ceil((windowMs - (now - hits[0])) / 1000);
    store.set(key, { hits, windowMs });
    return { ok: false, retryAfterSec: Math.max(1, retry) };
  }
  hits.push(now);
  // delete + set：讓活躍的 key 移到 Map 尾端，超量清除時先丟最久沒動的
  store.delete(key);
  store.set(key, { hits, windowMs });
  return { ok: true, retryAfterSec: 0 };
}

export function clearLimit(key: string) {
  store.delete(key);
}

/**
 * 節流用的「來源」key。
 * - TRUST_PROXY=1：前面有自己的反向代理，取 X-Forwarded-For 最右邊（由最近一層代理附加、客戶端偽造不了）那一段
 * - 其他情況：一律回固定值 "direct"——直連時 XFF 是客戶端可以任意偽造的，拿來當 key 等於沒節流
 *   （代價是所有直連客戶端共用同一個桶，所以每個 clientKey 的上限要設得寬鬆）
 */
export function clientKey(req: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const parts = (req.headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = parts[parts.length - 1] ?? req.headers.get("x-real-ip")?.trim();
    if (ip) return `ip:${ip}`;
  }
  return "direct";
}

/** 標準 429 回應：{ error: "too_many_attempts", retryAfterSec } ＋ Retry-After 標頭 */
export function tooManyResponse(retryAfterSec: number) {
  return NextResponse.json(
    { error: "too_many_attempts", retryAfterSec },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

/**
 * 依序檢查多個節流條件，第一個超量的就回 429 回應；全部通過回 null。
 * 用法：const limited = checkLimits([[`x:${email}`, 5, 15 * 60_000]]); if (limited) return limited;
 */
export function checkLimits(
  rules: Array<[key: string, limit: number, windowMs: number]>,
) {
  for (const [key, limit, windowMs] of rules) {
    const rl = rateLimit(key, limit, windowMs);
    if (!rl.ok) return tooManyResponse(rl.retryAfterSec);
  }
  return null;
}
