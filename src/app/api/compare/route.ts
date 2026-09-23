import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { emailGate } from "@/lib/gate";
import { cachedComparison, runSoloBaseline, swarmMetricsForRun } from "@/lib/compare";
import { inFlight, singleFlight, throttle } from "@/lib/costGuard";
import { apiError, HttpError, isId, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * 只有 run 的當事人（A 或 B）能看/跑對照。
 * 對照固定是 A 方視角（A 的隊長報告 vs A 的單體 baseline），回應附 viewerSide 讓前端標示。
 */
async function memberRun(uid: string, runId: unknown) {
  if (!isId(runId)) throw new HttpError(400, "runId required");
  const run = await prisma.matchRun.findUnique({
    where: { id: runId },
    select: { id: true, userAId: true, userBId: true, status: true },
  });
  if (!run) throw new HttpError(404, "not_found");
  if (run.userAId !== uid && run.userBId !== uid)
    throw new HttpError(403, "forbidden");
  return { run, viewerSide: (run.userAId === uid ? "A" : "B") as "A" | "B" };
}

/** GET ?runId= → 已快取的對照（沒有單體結果時只回蜂群） */
export const GET = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");
  const { run, viewerSide } = await memberRun(
    uid,
    new URL(req.url).searchParams.get("runId"),
  );

  const cached = await cachedComparison(run.id);
  if (cached)
    return NextResponse.json({ comparison: cached, perspective: "A", viewerSide });
  const swarm = await swarmMetricsForRun(run.id);
  if (!swarm) return apiError(404, "not_found");
  return NextResponse.json({ comparison: null, swarm, perspective: "A", viewerSide });
}, "compare GET");

/**
 * POST { runId, force? } → 跑一次單體 baseline（1 次 LLM 呼叫）並回傳對照。
 * - 已有 baseline 且沒帶 force：直接用快取（不呼叫 LLM、不計次）
 * - 真的要呼叫 LLM：每個 run 每分鐘最多 1 次（429 rate_limited）；同一 run 並發請求共用同一次計算
 */
export const POST = route(async (req: Request) => {
  const uid = await getCurrentUserId();
  if (!uid) return apiError(401, "unauthorized");
  const body = await readJson<{ runId?: string; force?: boolean }>(req);

  const gate = await emailGate(uid);
  if (gate) return apiError(403, gate);

  const { run, viewerSide } = await memberRun(uid, body.runId);
  if (run.status !== "completed") return apiError(404, "cannot_compare");
  const force = body.force === true;

  const flightKey = `compare:${run.id}`;
  let cmp: Awaited<ReturnType<typeof runSoloBaseline>>;
  if (inFlight(flightKey)) {
    cmp = await singleFlight(flightKey, () => runSoloBaseline(run.id));
  } else {
    const hasBaseline = await prisma.soloBaseline.findUnique({
      where: { runId: run.id },
      select: { id: true },
    });
    if (hasBaseline && !force) {
      cmp = await runSoloBaseline(run.id);
    } else {
      throttle("compare", run.id);
      cmp = await singleFlight(flightKey, () => runSoloBaseline(run.id, { force }));
    }
  }
  if (!cmp) return apiError(404, "cannot_compare");
  return NextResponse.json({ comparison: cmp, perspective: "A", viewerSide });
}, "compare POST");
