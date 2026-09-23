import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

/**
 * API 路由共用的輸入驗證與錯誤回應。
 *
 * - readJson(req)：body 不是合法 JSON 物件 → 400 invalid_json；過大 → 413 payload_too_large
 * - route(handler)：包住 handler，HttpError 轉成對應狀態碼；其他例外一律 500 internal_error，
 *   只寫伺服器 log，不把 stack／Prisma 細節回給用戶端
 */

/** 可預期的錯誤：帶狀態碼與機器可讀的錯誤碼（回應格式 { error: code, ...extra }） */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** 統一的錯誤回應：{ error: code, ...extra } */
export function apiError(
  status: number,
  code: string,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json({ error: code, ...extra }, { status, headers });
}

/** 預設 body 上限 64KB（所有 JSON 端點都只收短欄位） */
const DEFAULT_MAX_BYTES = 64 * 1024;

/**
 * 讀取 JSON 物件 body。
 * - 空 body：allowEmpty 時回 {}，否則 400 invalid_json
 * - 不是 JSON、或不是物件（陣列 / null / 純值）：400 invalid_json
 * - 超過 maxBytes：413 payload_too_large
 */
export async function readJson<T extends object = Record<string, unknown>>(
  req: Request,
  opts?: { allowEmpty?: boolean; maxBytes?: number },
): Promise<Partial<T>> {
  const max = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) throw new HttpError(413, "payload_too_large");
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  if (text.length > max) throw new HttpError(413, "payload_too_large");
  if (!text.trim()) {
    if (opts?.allowEmpty) return {};
    throw new HttpError(400, "invalid_json");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new HttpError(400, "invalid_json");
  return data as Partial<T>;
}

/** 取字串欄位：非字串回 undefined；有值時 trim。 */
export function str(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() : undefined;
}

/** id 類參數（cuid / seed-xxx）：非空、長度合理、不含空白 */
export function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 128 && !/\s/.test(v);
}

/** 把任何例外轉成安全的回應（不外洩 stack / Prisma 細節） */
export function errorResponse(e: unknown, where?: string): NextResponse {
  if (e instanceof HttpError) {
    const retry = e.extra?.retryAfterSec;
    return apiError(
      e.status,
      e.code,
      e.extra,
      typeof retry === "number" ? { "Retry-After": String(retry) } : undefined,
    );
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025：要更新/刪除的資料不存在（多半是併發下被別人先刪了）
    if (e.code === "P2025") return apiError(404, "not_found");
    // P2002：唯一鍵衝突（併發重複建立）
    if (e.code === "P2002") return apiError(409, "conflict");
  }
  console.error(`[api] ${where ?? "handler"} failed`, e);
  return apiError(500, "internal_error");
}

/**
 * 包住 route handler：HttpError → 對應狀態碼；其他例外 → 500 internal_error。
 * 用法：export const POST = route(async (req: Request, ctx: Ctx) => { ... });
 */
export function route<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
  where?: string,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      return errorResponse(e, where);
    }
  };
}
