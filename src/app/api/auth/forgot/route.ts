import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createAuthToken, devResetLinksEnabled, readJsonBody, str } from "@/lib/auth";
import { checkLimits, clientKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * 忘記密碼。
 * - 只有 AUTH_DEV_RESET_LINKS=on 且非 production 時，才會對「有密碼的帳號」在回應裡附上 devResetUrl（測試/本機 demo 用）。
 * - 其他情況一律回 { ok: true, devResetUrl: null }，而且完全不查帳號：
 *   回應內容與時間都與帳號是否存在無關（目前尚未接 SMTP，所以正式環境這支 API 不會寄出任何東西）。
 */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  const clean = str(body?.email)?.trim().toLowerCase();
  if (!clean || clean.length > 254)
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  // 同一 email 15 分鐘 3 次；同一來源 15 分鐘 20 次（避免對大量 email 掃描）
  const limited = checkLimits([
    [`forgot:email:${clean}`, 3, 15 * 60 * 1000],
    [`forgot:client:${clientKey(req)}`, 20, 15 * 60 * 1000],
  ]);
  if (limited) return limited;

  if (!devResetLinksEnabled()) return NextResponse.json({ ok: true, devResetUrl: null });

  const user = await prisma.user.findUnique({ where: { email: clean } });
  let devResetUrl: string | null = null;
  if (user?.passwordHash) {
    const token = await createAuthToken(user.id, "reset", 30);
    const origin = new URL(req.url).origin;
    devResetUrl = `${origin}/reset?token=${token}`;
  }
  return NextResponse.json({ ok: true, devResetUrl });
}
