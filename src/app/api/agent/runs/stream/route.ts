import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { ensureReaped } from "@/lib/costGuard";
import { apiError, isId, route } from "@/lib/http";
import { MAX_STREAM_RUNS, runsStream } from "../runStream";

export const dynamic = "force-dynamic";
/** 長連線：平台到時限會切斷；用戶端（RunStream）會重連，伺服器重送歷史、以 (runId, seq) 去重 */
export const maxDuration = 300;

/**
 * 多工逐字稿串流：GET /api/agent/runs/stream?ids=a,b,c
 * 一條 SSE 看最多 8 場互盤（避免瀏覽器 HTTP/1.1 每主機 6 連線上限被 run 串流佔滿）。
 * - 401 unauthorized：未登入
 * - 400 invalid_ids：沒給 ids、超過 8 個、或格式不對（回應附 max）
 * - 403 forbidden：任一 id 不存在或你不是該 run 的 A/B（回應附 runIds 列出被拒的 id）
 * - 429 too_many_streams：同一使用者同時開太多串流
 * 事件格式見 ../runStream.ts（每則都帶 runId）。
 */
export const GET = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");

  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
  if (ids.length === 0 || ids.length > MAX_STREAM_RUNS || !ids.every(isId))
    return apiError(400, "invalid_ids", { max: MAX_STREAM_RUNS });

  const runs = await prisma.matchRun.findMany({
    where: { id: { in: ids } },
    select: { id: true, userAId: true, userBId: true },
  });
  const byId = new Map(runs.map((r) => [r.id, r]));
  const forbidden = ids.filter((id) => {
    const r = byId.get(id);
    return !r || (r.userAId !== uid && r.userBId !== uid);
  });
  if (forbidden.length > 0)
    return apiError(403, "forbidden", { runIds: forbidden });

  await ensureReaped();
  return runsStream(uid, ids, req.signal);
}, "agent/runs/stream");
