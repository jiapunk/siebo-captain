import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getIdentity, UID_COOKIE } from "@/lib/session";
import { deleteUserAndData, SID_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 只回「當前身分自己」的資料；email 只會是自己的（sd_uid 已限定為沒有 email 的示範身分） */
export async function GET() {
  const llmMode =
    process.env.LLM_PROVIDER === "real" && process.env.LLM_API_KEY
      ? "real"
      : process.env.LLM_PROVIDER === "hybrid" && process.env.LLM_API_KEY
        ? "hybrid"
        : "mock";
  const { uid, mode: authMode } = await getIdentity();
  if (!uid) return NextResponse.json({ user: null, llmMode });
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: uid },
      include: { profile: { select: { status: true } } },
    }),
    prisma.eventMember.findFirst({
      where: { userId: uid },
      orderBy: { joinedAt: "desc" },
      include: { event: true },
    }),
  ]);
  if (!user) return NextResponse.json({ user: null, llmMode });
  return NextResponse.json({
    llmMode,
    authMode,
    user: {
      id: user.id,
      name: user.name,
      emoji: user.emoji,
      tagline: user.tagline,
      isBot: user.isBot,
      email: user.email,
      emailVerified: user.email ? Boolean(user.emailVerifiedAt) : null,
      event: membership
        ? { id: membership.event.id, name: membership.event.name, code: membership.event.code }
        : null,
      profileStatus: user.profile?.status ?? "draft",
    },
  });
}

/**
 * 刪除自己的帳號與所有個人資料（見 deleteUserAndData），並清掉 sc_sid / sd_uid。
 * 真帳號與示範身分都可刪；種子角色（id 以 seed- 開頭或 isBot）是 demo 固定班底，回 403 seed_identity。
 */
export async function DELETE() {
  const { uid } = await getIdentity();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, isBot: true },
  });
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.isBot || user.id.startsWith("seed-"))
    return NextResponse.json({ error: "seed_identity" }, { status: 403 });

  await deleteUserAndData(uid);

  const store = await cookies();
  store.delete(SID_COOKIE);
  store.delete(UID_COOKIE);
  return NextResponse.json({ ok: true, deleted: true });
}
