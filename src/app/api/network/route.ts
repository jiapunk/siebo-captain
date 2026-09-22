import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { buildNetwork } from "@/lib/network";

export const dynamic = "force-dynamic";

/** 合作網絡圖 + 社交/能力兩種信號的模擬對照 */
export async function GET() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = await buildNetwork(uid);
  return NextResponse.json(payload);
}
