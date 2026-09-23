import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { startMatching } from "@/lib/matching";
import { getServerLocale } from "@/lib/locale";
import { ensureReaped, throttle, tryLock } from "@/lib/costGuard";
import { apiError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";
/** 回應後的互盤（after 追蹤的 runPair）也算在這個時限內；逾時沒跑完的 run 由 reapStaleRuns 收尾成 failed */
export const maxDuration = 300;

/**
 * 隊長出發：對最多 5 位候選各開一場互盤（回應後以 after() 追蹤執行）。
 * - 409 no_event：還沒加入任何活動（候選只在同一場活動裡找，不做全域配對）
 * - 409 already_running：你上一輪還有 running 的 run（回應附 runIds），或同一瞬間的重複請求
 * - 429 rate_limited：每人 10 次 / 10 分鐘，另有每來源／全站預算（附 retryAfterSec、scope；見 costGuard SHARED_LIMITS）
 */
export const POST = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");

  const gate = await emailGate(uid);
  if (gate) return apiError(403, gate);
  // 空 body 允許；有 body 就必須是合法 JSON
  const body = await readJson<{ faultInject?: boolean }>(req, { allowEmpty: true });
  const faultInject = body.faultInject === true;

  // 同一使用者的並發請求：只放行第一個（建立 run 列之前的空窗）
  const release = tryLock(`matching:${uid}`, 60_000);
  if (!release) return apiError(409, "already_running", { runIds: [] });
  const pending: Promise<void>[] = [];
  try {
    await ensureReaped();
    const running = await prisma.matchRun.findMany({
      where: { userAId: uid, status: "running" },
      select: { id: true },
    });
    if (running.length > 0)
      return apiError(409, "already_running", { runIds: running.map((r) => r.id) });

    throttle("matching", uid, req);

    const locale = await getServerLocale();
    const runIds = await startMatching(uid, locale, {
      faultInject,
      defer: (p) => pending.push(p),
    });
    if (runIds.length === 0) return apiError(409, "no_candidates");
    return NextResponse.json({ runIds });
  } catch (e) {
    if ((e as Error).message === "PROFILE_NOT_READY")
      return apiError(400, "profile_not_ready");
    if ((e as Error).message === "NO_EVENT") return apiError(409, "no_event");
    throw e;
  } finally {
    // after()：回應先送出，互盤在背景跑；平台 waitUntil 與自架 graceful shutdown 都會等它們結束。
    // 放在 finally：startMatching 中途丟例外時，已經開跑的那幾場也照樣被追蹤
    if (pending.length > 0) after(() => Promise.allSettled(pending));
    release();
  }
}, "matching/run");
