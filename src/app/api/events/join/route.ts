import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/** 用活動 code 加入場次 */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = (await req.json()) as { code?: string };
  if (!code?.trim())
    return NextResponse.json({ error: "code_required" }, { status: 400 });

  const event = await prisma.event.findUnique({
    where: { code: code.trim().toUpperCase() },
  });
  if (!event)
    return NextResponse.json({ error: "invalid_event_code" }, { status: 404 });

  await prisma.eventMember.upsert({
    where: { eventId_userId: { eventId: event.id, userId: uid } },
    update: {},
    create: { eventId: event.id, userId: uid },
  });

  return NextResponse.json({
    event: { id: event.id, name: event.name, code: event.code },
  });
}
