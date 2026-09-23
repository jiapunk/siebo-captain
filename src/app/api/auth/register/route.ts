import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  authCookieOptions,
  createAuthToken,
  createSession,
  devAuthLinksEnabled,
  hashPassword,
  readJsonBody,
  str,
  validatePassword,
  SID_COOKIE,
} from "@/lib/auth";
import { UID_COOKIE } from "@/lib/session";
import { checkLimits, clientKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  const password = str(body.password);
  const name = str(body.name)?.trim();
  const emoji = str(body.emoji)?.trim();
  const eventCode = str(body.eventCode)?.trim();

  const cleanEmail = str(body.email)?.trim().toLowerCase();
  if (
    !cleanEmail ||
    cleanEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)
  )
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  // 節流：同一 email 15 分鐘 5 次、同一來源 10 分鐘 30 次（直連時所有人共用 "direct" 桶，所以放寬）
  const limited = checkLimits([
    [`register:email:${cleanEmail}`, 5, 15 * 60 * 1000],
    [`register:client:${clientKey(req)}`, 30, 10 * 60 * 1000],
  ]);
  if (limited) return limited;

  if (!password)
    return NextResponse.json({ error: "weak_password" }, { status: 400 });
  const pwErr = validatePassword(password, cleanEmail);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });
  if (!name)
    return NextResponse.json({ error: "name_required" }, { status: 400 });

  const exists = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (exists) return NextResponse.json({ error: "email_taken" }, { status: 409 });

  let eventId: string | null = null;
  if (eventCode) {
    const event = await prisma.event.findUnique({
      where: { code: eventCode.toUpperCase() },
    });
    if (!event)
      return NextResponse.json({ error: "invalid_event_code" }, { status: 400 });
    eventId = event.id;
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: name.slice(0, 12),
        emoji: emoji ? Array.from(emoji).slice(0, 4).join("") : "🚀",
        tagline: "新選手",
        email: cleanEmail,
        passwordHash: hashPassword(password),
        profile: { create: { status: "draft", interview: [] } },
        ...(eventId ? { events: { create: { eventId } } } : {}),
      },
    });
  } catch (e) {
    // 併發註冊同一 email：unique constraint → 409，而不是 500
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    throw e;
  }

  // 建立 Email 驗證權杖（dev 模式回傳連結，正式版改寄信）
  const verifyToken = await createAuthToken(user.id, "verify", 60 * 24);
  const origin = new URL(req.url).origin;
  const devVerifyUrl = devAuthLinksEnabled()
    ? `${origin}/verify?token=${verifyToken}`
    : null;

  const token = await createSession(user.id);
  const store = await cookies();
  store.set(SID_COOKIE, token, authCookieOptions(req));
  store.delete(UID_COOKIE); // 真帳號優先，清掉 demo 身分

  return NextResponse.json({
    id: user.id,
    name: user.name,
    emoji: user.emoji,
    devVerifyUrl,
  });
}
