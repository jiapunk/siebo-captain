import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  UID_COOKIE,
  demoSwitchEnabled,
  getAuthMode,
  isDemoIdentity,
} from "@/lib/session";
import { authCookieOptions, readJsonBody, str } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 切換到示範身分（sd_uid cookie）。
 * - DEMO_SWITCH=off → 403 demo_switch_disabled
 * - 目標不是示範身分（有 email 或密碼的真帳號）→ 403 not_demo_identity
 * - 已用真帳號登入 → 409 session_active（真 session 永遠優先，要先登出才能切換）
 */
export async function POST(req: Request) {
  if (!demoSwitchEnabled())
    return NextResponse.json({ error: "demo_switch_disabled" }, { status: 403 });

  const body = await readJsonBody(req);
  const userId = str(body?.userId)?.trim();
  if (!userId || userId.length > 128)
    return NextResponse.json({ error: "userId required" }, { status: 400 });

  const exists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!exists) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await isDemoIdentity(userId)))
    return NextResponse.json({ error: "not_demo_identity" }, { status: 403 });

  if ((await getAuthMode()) === "session")
    return NextResponse.json({ error: "session_active" }, { status: 409 });

  const store = await cookies();
  store.set(UID_COOKIE, userId, authCookieOptions(req));
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(UID_COOKIE);
  return NextResponse.json({ ok: true });
}
