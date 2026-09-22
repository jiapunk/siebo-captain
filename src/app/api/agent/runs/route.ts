import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import type { MatchReport } from "@/lib/types";
import { partRowsByRun, partsByRun } from "@/lib/swarm";

export const dynamic = "force-dynamic";

export async function GET() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const runs = await prisma.matchRun.findMany({
    where: { OR: [{ userAId: uid }, { userBId: uid }] },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const otherIds = Array.from(new Set(runs.map((r) => (r.userAId === uid ? r.userBId : r.userAId))));
  const others = await prisma.user.findMany({
    where: { id: { in: otherIds } },
    select: { id: true, name: true, emoji: true, isBot: true },
  });
  const otherMap = new Map(others.map((o) => [o.id, o]));

  const partsMap = await partsByRun(runs.map((r) => r.id));
  const partRowsMap = await partRowsByRun(runs.map((r) => r.id));

  return NextResponse.json({
    runs: runs.map((r) => {
      const isA = r.userAId === uid;
      const report: MatchReport | null = (isA ? r.reportA : r.reportB) as MatchReport | null;
      const otherId = isA ? r.userBId : r.userAId;
      const other = otherMap.get(otherId);
      return {
        id: r.id,
        status: r.status,
        other: other
          ? { name: other.name, emoji: other.emoji, isBot: other.isBot }
          : { name: "未知", emoji: "❓", isBot: false },
        myReport: report,
        createdAt: r.createdAt,
        eventCount: ((r.events as unknown as unknown[]) ?? []).length,
        parts: partsMap.get(r.id) ?? null,
        partRows: partRowsMap.get(r.id) ?? [],
      };
    }),
  });
}
