import { NextResponse, type NextRequest } from "next/server";

/**
 * CSRF 深度防禦（Next 16：middleware 已改名 proxy，預設跑在 Node.js runtime）。
 * Next 只替 Server Actions 比對 Origin/Host，Route Handler 不會，所以這裡自己做：
 * - 只看 /api/* 的非 GET/HEAD 請求；GET/HEAD（含 SSE 串流）一律放行
 * - 沒有 Origin 標頭（curl、伺服器對伺服器、Playwright request）→ 放行，交給 SameSite=Lax cookie
 * - 有 Origin 但 host 與 Host 不符（或 Origin 為 "null"/無法解析）→ 403 { error: "bad_origin" }
 * - TRUST_PROXY=1 時，X-Forwarded-Host 也算合法的 host（前面有自己的反代/tunnel 改寫 Host 時用）
 */
export function proxy(request: NextRequest) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return NextResponse.next();

  const origin = request.headers.get("origin");
  if (!origin) return NextResponse.next();

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return badOrigin();
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return badOrigin();

  const hosts = [request.headers.get("host")];
  if (process.env.TRUST_PROXY === "1") {
    hosts.push(...(request.headers.get("x-forwarded-host") ?? "").split(","));
  }
  const ok = hosts.some((h) => sameHost(originUrl, h));
  return ok ? NextResponse.next() : badOrigin();
}

/** 以 Origin 的 scheme 正規化 Host（小寫、去掉預設 port）後比對 */
function sameHost(origin: URL, host: string | null | undefined): boolean {
  const h = host?.trim();
  if (!h) return false;
  try {
    return new URL(`${origin.protocol}//${h}`).host === origin.host;
  } catch {
    return false;
  }
}

function badOrigin() {
  return NextResponse.json({ error: "bad_origin" }, { status: 403 });
}

export const config = {
  matcher: "/api/:path*",
};
