import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const event = await prisma.event.findFirst({
    orderBy: { startsAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  if (!event) return NextResponse.json({ event: null });
  const dayMs = 86_400_000;
  const now = Date.now();
  const start = event.startsAt.getTime();
  const end = event.endsAt ? event.endsAt.getTime() : null;
  const live = now >= start && (end === null || now <= end);
  const day = Math.max(1, Math.floor((now - start) / dayMs) + 1);
  const totalDays = end ? Math.max(1, Math.ceil((end - start) / dayMs)) : null;
  return NextResponse.json({
    event: {
      id: event.id,
      name: event.name,
      code: event.code,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      live,
      day,
      totalDays,
      memberCount: event._count.members,
    },
  });
}
