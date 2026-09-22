import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthMode, getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const llmMode =
    process.env.LLM_PROVIDER === "real" && process.env.LLM_API_KEY
      ? "real"
      : process.env.LLM_PROVIDER === "hybrid" && process.env.LLM_API_KEY
        ? "hybrid"
        : "mock";
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ user: null, llmMode });
  const [user, authMode, membership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: uid },
      include: { profile: { select: { status: true } } },
    }),
    getAuthMode(),
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
