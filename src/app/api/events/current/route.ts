import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const event = await prisma.event.findFirst({
    orderBy: { startsAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  if (!event) return NextResponse.json({ event: null });
  return NextResponse.json({
    event: {
      id: event.id,
      name: event.name,
      code: event.code,
      startsAt: event.startsAt,
      memberCount: event._count.members,
    },
  });
}
