import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { assembleTeams } from "@/lib/teamAssembler";
import { getServerLocale } from "@/lib/locale";
import { throttle, tryLock } from "@/lib/costGuard";
import { apiError, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 產生隊伍提案（最多 15 次隔離評估）。
 * - 409 already_running：你上一個組隊請求還在跑
 * - 429 rate_limited：每人 10 次 / 10 分鐘，另有每來源／全站預算（見 costGuard SHARED_LIMITS）
 */
export const POST = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");

  const gate = await emailGate(uid);
  if (gate) return apiError(403, gate);

  const release = tryLock(`assemble:${uid}`, 5 * 60_000);
  if (!release) return apiError(409, "already_running");
  try {
    throttle("assemble", uid, req);
    const locale = await getServerLocale();
    const teamIds = await assembleTeams(uid, locale);
    if (teamIds.length === 0) return apiError(409, "not_enough_candidates");
    return NextResponse.json({ teamIds });
  } catch (e) {
    const m = (e as Error).message;
    if (m === "PROFILE_NOT_READY" || m === "WRONG_DOMAIN")
      return apiError(400, "profile_not_ready");
    throw e;
  } finally {
    release();
  }
}, "teams/assemble");
