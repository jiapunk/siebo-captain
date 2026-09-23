import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  consumeAuthToken,
  hashPassword,
  readJsonBody,
  str,
  validatePassword,
} from "@/lib/auth";
import { clearLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** 以權杖重設密碼，並登出所有裝置 */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  const token = str(body?.token);
  const password = str(body?.password);
  if (!token || !password || token.length > 256)
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
  // 重設成功後解除該 email 的登入鎖定，讓使用者能立刻用新密碼登入
  clearLimit(`login:${user.email}`);

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
