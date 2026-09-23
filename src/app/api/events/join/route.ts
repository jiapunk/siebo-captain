import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { throttle } from "@/lib/costGuard";
import { apiError, readJson, route, str } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 用活動 code 加入場次。
 * - 400 code_required / invalid_json；404 invalid_event_code
 * - 429 rate_limited：每人 10 次 / 10 分鐘（防猜代碼）
 */
export const POST = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");

  const body = await readJson<{ code?: string }>(req);
  const code = str(body.code);
  if (!code || code.length > 64) return apiError(400, "code_required");

  throttle("eventJoin", uid);

  const event = await prisma.event.findUnique({
    where: { code: code.toUpperCase() },
  });
  if (!event) return apiError(404, "invalid_event_code");

  await prisma.eventMember.upsert({
    where: { eventId_userId: { eventId: event.id, userId: uid } },
    update: {},
    create: { eventId: event.id, userId: uid },
  });

  return NextResponse.json({
    event: { id: event.id, name: event.name, code: event.code },
  });
}, "events/join");
