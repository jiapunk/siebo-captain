import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  createAuthToken,
  createSession,
  devAuthLinksEnabled,
  hashPassword,
  validatePassword,
  SID_COOKIE,
} from "@/lib/auth";
import { UID_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, password, name, emoji, eventCode } = (await req.json()) as {
    email?: string;
    password?: string;
    name?: string;
    emoji?: string;
    eventCode?: string;
  };

  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  if (!password)
    return NextResponse.json({ error: "weak_password" }, { status: 400 });
  const pwErr = validatePassword(password, cleanEmail);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });
  if (!name?.trim())
    return NextResponse.json({ error: "name_required" }, { status: 400 });

  const exists = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (exists) return NextResponse.json({ error: "email_taken" }, { status: 409 });

  let eventId: string | null = null;
  if (eventCode?.trim()) {
    const event = await prisma.event.findUnique({
      where: { code: eventCode.trim().toUpperCase() },
    });
    if (!event)
      return NextResponse.json({ error: "invalid_event_code" }, { status: 400 });
    eventId = event.id;
  }

  const user = await prisma.user.create({
    data: {
      name: name.trim().slice(0, 12),
      emoji: emoji || "🚀",
      tagline: "新選手",
      email: cleanEmail,
      passwordHash: hashPassword(password),
      profile: { create: { status: "draft", interview: [] } },
    },
  });
  if (eventId) {
    await prisma.eventMember
      .create({ data: { eventId, userId: user.id } })
      .catch(() => {});
  }

  // 建立 Email 驗證權杖（dev 模式回傳連結，正式版改寄信）
  const verifyToken = await createAuthToken(user.id, "verify", 60 * 24);
  const origin = new URL(req.url).origin;
  const devVerifyUrl = devAuthLinksEnabled()
    ? `${origin}/verify?token=${verifyToken}`
    : null;

  const token = await createSession(user.id);
  const store = await cookies();
  store.set(SID_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  store.delete(UID_COOKIE); // 真帳號優先，清掉 demo 身分

  return NextResponse.json({
    id: user.id,
    name: user.name,
    emoji: user.emoji,
    devVerifyUrl,
  });
}
