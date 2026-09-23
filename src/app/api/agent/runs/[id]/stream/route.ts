import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { ensureReaped } from "@/lib/costGuard";
import { runsStream } from "../../runStream";

export const dynamic = "force-dynamic";
/** 長連線：平台到時限會切斷；用戶端會重連，伺服器重送歷史、以 (runId, seq) 去重 */
export const maxDuration = 300;

/**
 * 單一 run 的逐字稿串流（舊路由，保留相容）。
 * 新前端請改用多工的 GET /api/agent/runs/stream?ids=a,b,c（一條連線看多場）。
 * 事件格式與多工路由相同（見 ../../runStream.ts）。
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const uid = await getCurrentUserId();
  if (!uid) return new Response("unauthorized", { status: 401 });
  const { id } = await ctx.params;

  const run = await prisma.matchRun.findUnique({
    where: { id },
    select: { userAId: true, userBId: true },
  });
  if (!run || (run.userAId !== uid && run.userBId !== uid))
    return new Response("not found", { status: 404 });

  await ensureReaped();
  return runsStream(uid, [id], req.signal);
}
