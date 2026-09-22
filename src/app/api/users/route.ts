import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const uid = await getCurrentUserId();
  const users = await prisma.user.findMany({
    orderBy: [{ isBot: "desc" }, { createdAt: "asc" }],
    include: { profile: { select: { status: true } } },
  });
  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      emoji: u.emoji,
      tagline: u.tagline,
      isBot: u.isBot,
      profileStatus: u.profile?.status ?? "draft",
      isMe: u.id === uid,
    })),
  });
}

export async function POST(req: Request) {
  const { name, emoji, eventCode } = (await req.json()) as {
    name?: string;
    emoji?: string;
    eventCode?: string;
  };
  if (!name?.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 });
  const user = await prisma.user.create({
    data: {
      name: name.trim().slice(0, 12),
      emoji: emoji || "🚀",
      tagline: "新選手",
      isBot: false,
      profile: { create: { status: "draft", interview: [] } },
    },
  });
  // 用活動 code 加入場次；沒帶 code 則加入最近的場次（demo 友善）
  if (eventCode?.trim()) {
    const event = await prisma.event.findUnique({
      where: { code: eventCode.trim().toUpperCase() },
    });
    if (!event) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
      return NextResponse.json(
        { error: "invalid_event_code" },
        { status: 400 },
      );
    }
    await prisma.eventMember.create({
      data: { eventId: event.id, userId: user.id },
    });
  } else {
    const event = await prisma.event.findFirst({
      orderBy: { startsAt: "desc" },
    });
    if (event) {
      await prisma.eventMember
        .create({ data: { eventId: event.id, userId: user.id } })
        .catch(() => {});
    }
  }
  return NextResponse.json({ id: user.id });
}
