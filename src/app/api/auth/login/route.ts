import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { createSession, verifyPassword, SID_COOKIE } from "@/lib/auth";
import { UID_COOKIE } from "@/lib/session";
import { clearLimit, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { email, password } = (await req.json()) as {
    email?: string;
    password?: string;
  };
  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail || !password)
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const rl = rateLimit(`login:${cleanEmail}:${ip}`, 8, 15 * 60 * 1000);
  if (!rl.ok)
    return NextResponse.json(
      { error: "too_many_attempts", retryAfterSec: rl.retryAfterSec },
      { status: 429 },
    );

  const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash))
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  clearLimit(`login:${cleanEmail}:${ip}`);

  const token = await createSession(user.id);
  const store = await cookies();
  store.set(SID_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  store.delete(UID_COOKIE);

  return NextResponse.json({ id: user.id, name: user.name, emoji: user.emoji });
}
