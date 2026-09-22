import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { UID_COOKIE } from "@/lib/session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { userId } = (await req.json()) as { userId?: string };
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  const store = await cookies();
  store.set(UID_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const store = await cookies();
  store.delete(UID_COOKIE);
  return NextResponse.json({ ok: true });
}
