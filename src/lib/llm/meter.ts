import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 呼叫計量（call meter）：統計一個 Part 內「實際打出去的 HTTP 請求」。
 *
 * 不改 LLMClient 介面：runPart 用 withMeter() 包住每次嘗試，
 * real.ts / decide.ts 在發出請求時呼叫 recordCall()／recordRetry()，
 * 數字透過 AsyncLocalStorage 回到當前 Part。沒有 meter 的呼叫（例如 API 路由直接用 llm.*）會被忽略。
 */
export interface CallMeter {
  /** 實際發出的 HTTP 請求數（含重試） */
  calls: number;
  /** 其中屬於「重試」的次數（real.ts 自身重試、decide 覆蓋不足重打） */
  retries: number;
  inputTokens: number;
  outputTokens: number;
  /** 是否有任何一次呼叫回報了 token 用量 */
  hasUsage: boolean;
}

const als = new AsyncLocalStorage<CallMeter>();

export const emptyMeter = (): CallMeter => ({
  calls: 0,
  retries: 0,
  inputTokens: 0,
  outputTokens: 0,
  hasUsage: false,
});

/** 在獨立 meter 下執行 fn，回傳結果與這段期間的計量 */
export async function withMeter<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; meter: CallMeter }> {
  const meter = emptyMeter();
  const value = await als.run(meter, fn);
  return { value, meter };
}

/** 同上，但失敗時也把 meter 帶出來（錯誤掛在 meter 旁） */
export async function withMeterSettled<T>(
  fn: () => Promise<T>,
): Promise<
  | { ok: true; value: T; meter: CallMeter }
  | { ok: false; error: unknown; meter: CallMeter }
> {
  const meter = emptyMeter();
  try {
    const value = await als.run(meter, fn);
    return { ok: true, value, meter };
  } catch (error) {
    return { ok: false, error, meter };
  }
}

/** 記一次實際發出的請求（isRetry=true 表示這是同一請求的重試） */
export function recordCall(opts?: {
  isRetry?: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): void {
  const m = als.getStore();
  if (!m) return;
  m.calls++;
  if (opts?.isRetry) m.retries++;
  if (typeof opts?.inputTokens === "number" && Number.isFinite(opts.inputTokens)) {
    m.inputTokens += opts.inputTokens;
    m.hasUsage = true;
  }
  if (typeof opts?.outputTokens === "number" && Number.isFinite(opts.outputTokens)) {
    m.outputTokens += opts.outputTokens;
    m.hasUsage = true;
  }
}

/** 補記 token 用量到最近一次請求（回應解析完才拿得到 usage 時用） */
export function recordUsage(inputTokens?: number | null, outputTokens?: number | null): void {
  const m = als.getStore();
  if (!m) return;
  if (typeof inputTokens === "number" && Number.isFinite(inputTokens)) {
    m.inputTokens += inputTokens;
    m.hasUsage = true;
  }
  if (typeof outputTokens === "number" && Number.isFinite(outputTokens)) {
    m.outputTokens += outputTokens;
    m.hasUsage = true;
  }
}

export function mergeMeter(into: CallMeter, from: CallMeter): CallMeter {
  into.calls += from.calls;
  into.retries += from.retries;
  into.inputTokens += from.inputTokens;
  into.outputTokens += from.outputTokens;
  into.hasUsage = into.hasUsage || from.hasUsage;
  return into;
}

/**
 * 整段逾時（送出 → 讀完 body）：用一般的 setTimeout（會撐住 event loop），
 * 呼叫端讀完回應後必須 clear()。逾時錯誤的 name 為 TimeoutError。
 */
export function deadline(ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    const e = new Error(`timeout after ${ms}ms`);
    e.name = "TimeoutError";
    ctrl.abort(e);
  }, ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

/** 以 signal 為界的 Promise：signal 中止時立即 reject（用來把「讀 body」也納入逾時） */
export function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function abortError(): Error {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

/** AbortError / TimeoutError（AbortSignal.timeout）都視為逾時 */
export function isTimeoutError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}
