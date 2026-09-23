import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  DEMO_IDENTITY_WHERE,
  demoSwitchEnabled,
  getCurrentUserId,
} from "@/lib/session";
import { readJsonBody, str } from "@/lib/auth";
import { checkLimits, clientKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * 示範身分名冊（首頁 ROSTER／切換選單用）。
 * 只列示範身分（passwordHash 與 email 皆為 null），真帳號永遠不會出現；不回傳 email。
 * DEMO_SWITCH=off 時回空陣列。
 */
export async function GET() {
  if (!demoSwitchEnabled()) return NextResponse.json({ users: [] });
  const uid = await getCurrentUserId();
  const users = await prisma.user.findMany({
    where: DEMO_IDENTITY_WHERE,
    orderBy: [{ isBot: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      emoji: true,
      tagline: true,
      isBot: true,
      profile: { select: { status: true } },
    },
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

/**
 * 建立新的示範身分（無 email、無密碼 → 符合示範身分條件，可用 /api/session 切換）。
 * DEMO_SWITCH=off 時 403（建了也切換不進去）。
 */
export async function POST(req: Request) {
  if (!demoSwitchEnabled())
    return NextResponse.json({ error: "demo_switch_disabled" }, { status: 403 });

  const body = await readJsonBody(req);
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  const name = str(body.name)?.trim();
  const emoji = str(body.emoji)?.trim();
  const eventCode = str(body.eventCode)?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  // 不需登入就能建立 → 以來源節流，避免灌爆 DB（直連時所有人共用 "direct" 桶，上限放寬）
  const limited = checkLimits([[`users:create:${clientKey(req)}`, 60, 10 * 60 * 1000]]);
  if (limited) return limited;

  // 先確認活動代碼，再建立使用者（不再「先建後刪」）；沒帶 code 則加入最近的場次（demo 友善）
  const event = eventCode
    ? await prisma.event.findUnique({ where: { code: eventCode.toUpperCase() } })
    : await prisma.event.findFirst({ orderBy: { startsAt: "desc" } });
  if (eventCode && !event)
    return NextResponse.json({ error: "invalid_event_code" }, { status: 400 });

  const user = await prisma.user.create({
    data: {
      name: name.slice(0, 12),
      emoji: emoji ? Array.from(emoji).slice(0, 4).join("") : "🚀",
      tagline: "新選手",
      isBot: false,
      // 明確寫 null：示範身分的定義就是沒有 email 與密碼
      email: null,
      passwordHash: null,
      profile: { create: { status: "draft", interview: [] } },
      ...(event ? { events: { create: { eventId: event.id } } } : {}),
    },
  });
  return NextResponse.json({ id: user.id });
}
