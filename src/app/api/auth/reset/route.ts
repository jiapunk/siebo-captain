import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { consumeAuthToken, hashPassword, validatePassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 以權杖重設密碼，並登出所有裝置 */
export async function POST(req: Request) {
  const { token, password } = (await req.json()) as {
    token?: string;
    password?: string;
  };
  if (!token || !password)
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: (await getUserIdForToken(token)) ?? "" },
  });
  if (!user?.email)
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });

  const pwErr = validatePassword(password, user.email);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  const uid = await consumeAuthToken(token, "reset");
  if (!uid) return NextResponse.json({ error: "invalid_token" }, { status: 400 });

  await prisma.$transaction([
    prisma.user.update({
      where: { id: uid },
      data: { passwordHash: hashPassword(password) },
    }),
    // 重設後作廢所有登入工作階段
    prisma.session.deleteMany({ where: { userId: uid } }),
  ]);

  return NextResponse.json({ ok: true });
}

/** 先驗證權杖再消費（避免密碼規則錯誤時浪費權杖） */
async function getUserIdForToken(raw: string): Promise<string | null> {
  const { createHash } = await import("node:crypto");
  const id = createHash("sha256").update(raw).digest("hex");
  const t = await prisma.authToken.findUnique({ where: { id } });
  if (!t || t.kind !== "reset" || t.usedAt) return null;
  if (t.expiresAt.getTime() < Date.now()) return null;
  return t.userId;
}
