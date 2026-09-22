import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { assembleTeams } from "@/lib/teamAssembler";
import { getServerLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export async function POST() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const gate = await emailGate(uid);
  if (gate) return NextResponse.json({ error: gate }, { status: 403 });
  try {
    const locale = await getServerLocale();
    const teamIds = await assembleTeams(uid, locale);
    if (teamIds.length === 0)
      return NextResponse.json({ error: "not_enough_candidates" }, { status: 409 });
    return NextResponse.json({ teamIds });
  } catch (e) {
    const m = (e as Error).message;
    if (m === "PROFILE_NOT_READY" || m === "WRONG_DOMAIN")
      return NextResponse.json({ error: "profile_not_ready" }, { status: 400 });
    throw e;
  }
}
