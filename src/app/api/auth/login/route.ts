import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  authCookieOptions,
  createSession,
  readJsonBody,
  str,
  verifyPasswordOrDummy,
  SID_COOKIE,
} from "@/lib/auth";
import { UID_COOKIE } from "@/lib/session";
import { clearLimit, rateLimit, tooManyResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const LOGIN_LIMIT = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: Request) {
  const body = await readJsonBody(req);
  const cleanEmail = str(body?.email)?.trim().toLowerCase();
  const password = str(body?.password);
  if (!cleanEmail || !password || cleanEmail.length > 254 || password.length > 1024)
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  // 以 email 為 key：同一帳號 15 分鐘內 8 次嘗試，第 9 次起 429（換 X-Forwarded-For 也繞不過）
  const key = `login:${cleanEmail}`;
  const rl = rateLimit(key, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!rl.ok) return tooManyResponse(rl.retryAfterSec);

  const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
  // 帳號不存在或沒密碼時也跑一次假 scrypt，回應時間不洩漏帳號是否存在
  if (!verifyPasswordOrDummy(password, user?.passwordHash) || !user)
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  clearLimit(key);

  const token = await createSession(user.id);
  const store = await cookies();
  store.set(SID_COOKIE, token, authCookieOptions(req));
  store.delete(UID_COOKIE);

  return NextResponse.json({ id: user.id, name: user.name, emoji: user.emoji });
}
