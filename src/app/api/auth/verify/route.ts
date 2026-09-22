import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeAuthToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 驗證 Email（token 由註冊/重寄產生） */
export async function POST(req: Request) {
  const { token } = (await req.json()) as { token?: string };
  if (!token) return NextResponse.json({ error: "invalid_token" }, { status: 400 });

  const uid = await consumeAuthToken(token, "verify");
  if (!uid) return NextResponse.json({ error: "invalid_token" }, { status: 400 });

  await prisma.user.update({
    where: { id: uid },
    data: { emailVerifiedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
