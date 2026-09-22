import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { createAuthToken, devAuthLinksEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 重寄驗證連結（dev 模式直接回傳連結） */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user?.email)
    return NextResponse.json({ error: "no_email" }, { status: 400 });
  if (user.emailVerifiedAt)
    return NextResponse.json({ ok: true, alreadyVerified: true });

  const token = await createAuthToken(user.id, "verify", 60 * 24);
  const origin = new URL(req.url).origin;
  return NextResponse.json({
    ok: true,
    devVerifyUrl: devAuthLinksEnabled()
      ? `${origin}/verify?token=${token}`
      : null,
  });
}
