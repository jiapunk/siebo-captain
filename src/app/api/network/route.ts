import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { buildNetwork, type NetworkPayload } from "@/lib/network";
import { apiError, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 合作網絡圖 + 社交/能力兩種信號的模擬對照。
 * 權限：只看「你目前所在活動」的網絡（你最近加入的場次）；沒有加入任何活動 → 空圖，不回其他活動的資料。
 * 回應多一個 eventId（null = 沒有活動）。
 */
export const GET = route(async () => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");

  const membership = await prisma.eventMember.findFirst({
    where: { userId: uid },
    orderBy: { joinedAt: "desc" },
    select: { eventId: true },
  });
  if (!membership) {
    const empty: NetworkPayload = {
      mode: process.env.ASSEMBLY_SIGNAL === "social" ? "social" : "competence",
      nodes: [],
      edges: [],
      metrics: { edges: 0, avgDegree: 0, clustering: 0, hubs: [] },
      sim: null,
    };
    return NextResponse.json({ ...empty, eventId: null });
  }

  // buildNetwork 以同一規則（最近加入的場次）決定 eventId，與上面的 membership 一致
  const payload = await buildNetwork(uid);
  return NextResponse.json({ ...payload, eventId: membership.eventId });
}, "network");
