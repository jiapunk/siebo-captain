import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { startMatching } from "@/lib/matching";
import { getServerLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export async function POST() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const gate = await emailGate(uid);
  if (gate) return NextResponse.json({ error: gate }, { status: 403 });
  try {
    const locale = await getServerLocale();
    const runIds = await startMatching(uid, locale);
    if (runIds.length === 0)
      return NextResponse.json({ error: "no_candidates" }, { status: 409 });
    return NextResponse.json({ runIds });
  } catch (e) {
    if ((e as Error).message === "PROFILE_NOT_READY")
      return NextResponse.json({ error: "profile_not_ready" }, { status: 400 });
    throw e;
  }
}
