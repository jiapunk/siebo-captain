import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createAuthToken, devAuthLinksEnabled } from "@/lib/auth";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** 忘記密碼：一律回 200（避免帳號列舉）；dev 模式回傳重設連結 */
export async function POST(req: Request) {
  const { email } = (await req.json()) as { email?: string };
  const clean = email?.trim().toLowerCase();
  if (!clean)
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const rl = rateLimit(`forgot:${clean}`, 3, 15 * 60 * 1000);
  if (!rl.ok)
    return NextResponse.json(
      { error: "too_many_attempts", retryAfterSec: rl.retryAfterSec },
      { status: 429 },
    );

  const user = await prisma.user.findUnique({ where: { email: clean } });
  let devResetUrl: string | null = null;
  if (user?.passwordHash && devAuthLinksEnabled()) {
    const token = await createAuthToken(user.id, "reset", 30);
    const origin = new URL(req.url).origin;
    devResetUrl = `${origin}/reset?token=${token}`;
  }

  return NextResponse.json({ ok: true, devResetUrl });
}
