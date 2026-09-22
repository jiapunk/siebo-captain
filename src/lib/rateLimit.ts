/** 極簡記憶體滑動窗節流（單實例 demo 足夠；正式版應換 Redis/Upstash） */
type Bucket = number[];
const g = globalThis as unknown as { __rl?: Map<string, Bucket> };
const store: Map<string, Bucket> = g.__rl ?? (g.__rl = new Map());

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (bucket.length >= limit) {
    const retry = Math.ceil((windowMs - (now - bucket[0])) / 1000);
    store.set(key, bucket);
    return { ok: false, retryAfterSec: Math.max(1, retry) };
  }
  bucket.push(now);
  store.set(key, bucket);
  return { ok: true, retryAfterSec: 0 };
}

export function clearLimit(key: string) {
  store.delete(key);
}
